/**
 * The places proxy — the only thing in this repository that holds a mapping key.
 *
 * Why a proxy at all: `EXPO_PUBLIC_` values are compiled into the app bundle
 * and can be read back out of it by anyone who unzips it. That is fine for the
 * Supabase anon key, because RLS is what protects the data. It is not fine for
 * a billed third-party key, where possession *is* the authorization. So the key
 * lives in an Edge Function secret and the app never sees it.
 *
 * The app never learns whether a key exists, either — it asks. `op:
 * 'capabilities'` answers from the environment, and every screen that could
 * search hides itself when the answer is false. That is what makes the feature
 * optional in the same way the AI feature is: with nothing configured, the app
 * falls back to places typed by hand, and nothing here is ever called.
 *
 * Residual risk, stated plainly: Edge Functions have no static egress IP, so
 * the key cannot be IP-restricted. Restrict it by *API* in the provider console
 * — Places, Routes, Static Maps, nothing else — and note that the real abuse
 * control here is the JWT check plus the per-couple daily cap below.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  buildSearchBody,
  MAX_RESULTS,
  parseRequest,
  SEARCH_FIELD_MASK,
  toPlaceResults,
  toTravelMinutes,
  type PlacesFailure,
  type PlacesRequest,
} from './shape.ts';

/** Declared locally rather than pulling in a types package for one lookup. */
declare const Deno: { env: { get(name: string): string | undefined } };

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const ROUTES_ENDPOINT =
  'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const STATIC_MAP_ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap';

const DEFAULT_DAILY_LIMIT = 100;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(reason: PlacesFailure, status = 200): Response {
  // Always a reason code. The app turns it into a sentence in the reader's own
  // language; this function has no idea which language that is.
  return json({ ok: false, reason }, status);
}

/**
 * Count one request against the couple's day, and refuse past the cap.
 *
 * Uses the service role because `places_usage` is deliberately not writable by
 * `authenticated` — a client that could write here could reset its own cap.
 */
async function meter(coupleId: string): Promise<boolean> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const limit = Number(Deno.env.get('PLACES_DAILY_LIMIT') ?? DEFAULT_DAILY_LIMIT);

  const { data, error } = await admin.rpc('increment_places_usage', { p_couple_id: coupleId });
  if (error) {
    // Fail closed. A metering outage must not become an unmetered key.
    console.error('places_usage increment failed', error.message);
    return false;
  }
  return typeof data === 'number' && data <= (Number.isFinite(limit) ? limit : DEFAULT_DAILY_LIMIT);
}

async function callProvider(
  url: string,
  key: string,
  body: unknown,
  fieldMask?: string,
): Promise<unknown | null> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // The provider's error text can quote the request back; log the status
    // only, so a query never lands in a log by accident.
    console.error('provider responded', response.status);
    return null;
  }
  return response.json();
}

async function handle(request: PlacesRequest, key: string): Promise<Response> {
  switch (request.op) {
    case 'search':
    case 'geocode': {
      const body =
        request.op === 'search'
          ? buildSearchBody(request)
          : {
              textQuery: request.query,
              languageCode: request.languageCode,
              maxResultCount: 1,
            };
      const raw = await callProvider(
        request.op === 'search' ? PLACES_ENDPOINT : GEOCODE_ENDPOINT,
        key,
        body,
        SEARCH_FIELD_MASK,
      );
      if (raw === null) return fail('upstream');
      return json({ ok: true, data: toPlaceResults(raw).slice(0, MAX_RESULTS) });
    }

    case 'travelTime': {
      const raw = await callProvider(
        ROUTES_ENDPOINT,
        key,
        {
          origins: [
            {
              waypoint: {
                location: {
                  latLng: {
                    latitude: request.origin.latitude,
                    longitude: request.origin.longitude,
                  },
                },
              },
            },
          ],
          destinations: request.destinations.map((destination) => ({
            waypoint: {
              location: {
                latLng: {
                  latitude: destination.latitude,
                  longitude: destination.longitude,
                },
              },
            },
          })),
          travelMode: 'DRIVE',
          // The cheaper tier, and a steadier answer to "how far is that,
          // roughly" than a live-traffic estimate for a date three weeks out.
          routingPreference: 'TRAFFIC_UNAWARE',
        },
        'originIndex,destinationIndex,duration,condition',
      );
      if (raw === null) return fail('upstream');
      return json({ ok: true, data: toTravelMinutes(raw, request.destinations.length) });
    }

    case 'staticMap': {
      /**
       * The bytes, not a URL.
       *
       * A signed static-map URL still carries the key, and handing one to an
       * `<Image>` puts it on the device and into any proxy the phone is behind
       * — which is the thing this whole function exists to avoid. Fetching it
       * here costs one hop and keeps the key server-side.
       */
      const url = new URL(STATIC_MAP_ENDPOINT);
      url.searchParams.set('center', `${request.center.latitude},${request.center.longitude}`);
      url.searchParams.set('zoom', String(request.zoom));
      url.searchParams.set('size', `${request.width}x${request.height}`);
      url.searchParams.set('scale', '2');
      url.searchParams.set(
        'markers',
        `${request.center.latitude},${request.center.longitude}`,
      );
      url.searchParams.set('key', key);

      const response = await fetch(url);
      if (!response.ok) {
        console.error('static map responded', response.status);
        return fail('upstream');
      }

      return new Response(response.body, {
        headers: {
          'Content-Type': response.headers.get('Content-Type') ?? 'image/png',
          // A place does not move. Caching it on the device is the difference
          // between one billed request per venue and one per render.
          'Cache-Control': 'private, max-age=86400',
        },
      });
    }

    default:
      return fail('bad_request');
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const key = Deno.env.get('GOOGLE_MAPS_API_KEY');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('bad_request');
  }

  const parsed = parseRequest(body);
  if (!parsed) return fail('bad_request');

  // Answered before any auth work, so the probe every session makes is free
  // and still truthful when nothing is configured.
  if (parsed.op === 'capabilities') {
    const configured = Boolean(key);
    return json({
      ok: true,
      data: { search: configured, travelTime: configured, staticMap: configured },
    });
  }

  if (!key) return fail('not_configured');

  const authorization = req.headers.get('Authorization');
  if (!authorization) return fail('unauthenticated', 401);

  // Caller-scoped, so `current_couple_id()` answers for whoever holds the JWT.
  // The couple is never taken from the request body — that would let anyone
  // spend another couple's daily allowance.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  );

  const { data: coupleId, error } = await caller.rpc('current_couple_id');
  if (error || !coupleId) return fail('unauthenticated', 401);

  if (!(await meter(coupleId))) return fail('rate_limited');

  return handle(parsed, key);
});
