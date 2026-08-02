/**
 * Everything about a places request that is not I/O.
 *
 * Split out from `index.ts` so it can be tested in the ordinary suite with
 * fixtures and no network, no Deno, and no key. `index.ts` is then thin enough
 * to read in one sitting: authenticate, meter, forward, shape.
 *
 * Two rules hold throughout:
 *
 *  - Failures are reason codes, never raised English strings. Postgres speaks
 *    English and one of these two partners does not; the app turns a code into
 *    a sentence in the reader's own language, exactly as `join_couple` does.
 *  - Nothing here throws on malformed provider output. A search that comes back
 *    in an unexpected shape yields no results, which the screen already knows
 *    how to render.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface PlaceResult {
  providerPlaceId: string;
  name: string;
  address: string | null;
  coordinates: Coordinates | null;
}

export type PlacesRequest =
  | { op: 'capabilities' }
  | {
      op: 'search';
      query: string;
      near?: Coordinates;
      radiusMeters?: number;
      languageCode: 'en' | 'es';
      limit: number;
    }
  | { op: 'geocode'; query: string; languageCode: 'en' | 'es' }
  | { op: 'travelTime'; origin: Coordinates; destinations: Coordinates[] }
  | { op: 'staticMap'; center: Coordinates; zoom: number; width: number; height: number };

export type PlacesFailure =
  'not_configured' | 'rate_limited' | 'bad_request' | 'unauthenticated' | 'upstream';

export type PlacesResponse<T> = { ok: true; data: T } | { ok: false; reason: PlacesFailure };

/** At most this many venues per search — a shortlist, not a directory. */
export const MAX_RESULTS = 10;

/** One origin against at most this many destinations per travel-time call. */
export const MAX_DESTINATIONS = 10;

/**
 * The field mask *is* the billing tier.
 *
 * Everything here is in the cheapest Places tier. Photos, ratings, opening
 * hours and editorial summaries each move the whole request up a tier and
 * carry their own caching terms, and none of them answers "where should we
 * go". Pinned as a constant so widening it shows up in a diff.
 */
export const SEARCH_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseCoordinates(value: unknown): Coordinates | null {
  if (typeof value !== 'object' || value === null) return null;
  const { latitude, longitude } = value as Record<string, unknown>;
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function parseLanguage(value: unknown): 'en' | 'es' {
  return value === 'es' ? 'es' : 'en';
}

/**
 * Round a position to roughly a kilometre.
 *
 * Two decimal places is about 1.1 km at the equator and less further from it.
 * Nothing this feature does — venues around a neighbourhood, a two-hour drive
 * radius — is sensitive to more than that, and the difference between "this
 * couple is in Gràcia" and "this couple is at this address" is the whole
 * privacy question. Applied before anything leaves the device's request.
 */
export function coarsen(coordinates: Coordinates, decimals = 2): Coordinates {
  const factor = 10 ** decimals;
  return {
    latitude: Math.round(coordinates.latitude * factor) / factor,
    longitude: Math.round(coordinates.longitude * factor) / factor,
  };
}

/**
 * Reject anything malformed before a byte reaches a third party.
 *
 * Returns null rather than throwing, so the caller answers `bad_request` and
 * the provider never sees the request at all.
 */
export function parseRequest(body: unknown): PlacesRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const input = body as Record<string, unknown>;

  switch (input.op) {
    case 'capabilities':
      return { op: 'capabilities' };

    case 'search': {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (query.length === 0 || query.length > 200) return null;
      const near = parseCoordinates(input.near);
      const limit =
        isFiniteNumber(input.limit) && input.limit > 0
          ? Math.min(Math.floor(input.limit), MAX_RESULTS)
          : MAX_RESULTS;
      const radiusMeters = isFiniteNumber(input.radiusMeters)
        ? Math.min(Math.max(Math.floor(input.radiusMeters), 100), 50_000)
        : undefined;
      return {
        op: 'search',
        query,
        // Coarsened here rather than trusted from the client: this is the last
        // place we control before it becomes someone else's log line.
        ...(near ? { near: coarsen(near) } : {}),
        ...(radiusMeters === undefined ? {} : { radiusMeters }),
        languageCode: parseLanguage(input.languageCode),
        limit,
      };
    }

    case 'geocode': {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (query.length === 0 || query.length > 200) return null;
      return { op: 'geocode', query, languageCode: parseLanguage(input.languageCode) };
    }

    case 'travelTime': {
      const origin = parseCoordinates(input.origin);
      if (!origin) return null;
      const raw = Array.isArray(input.destinations) ? input.destinations : [];
      const destinations = raw
        .map(parseCoordinates)
        .filter((value): value is Coordinates => value !== null)
        .slice(0, MAX_DESTINATIONS);
      if (destinations.length === 0) return null;
      return {
        op: 'travelTime',
        origin: coarsen(origin),
        destinations: destinations.map((value) => coarsen(value)),
      };
    }

    case 'staticMap': {
      const center = parseCoordinates(input.center);
      if (!center) return null;
      // Clamped rather than rejected: a nonsensical size is a caller bug, and
      // an image the provider refuses to render is a worse answer than a
      // sensible one. The ceiling is the provider's own free-tier limit.
      const clamp = (value: unknown, min: number, max: number, fallback: number) =>
        isFiniteNumber(value) ? Math.min(Math.max(Math.floor(value), min), max) : fallback;
      return {
        op: 'staticMap',
        center: coarsen(center, 4),
        zoom: clamp(input.zoom, 1, 20, 15),
        width: clamp(input.width, 64, 640, 400),
        height: clamp(input.height, 64, 640, 200),
      };
    }

    default:
      return null;
  }
}

/** The Places "searchText" body. A location bias, never a hard restriction. */
export function buildSearchBody(request: Extract<PlacesRequest, { op: 'search' }>): unknown {
  return {
    textQuery: request.query,
    languageCode: request.languageCode,
    maxResultCount: request.limit,
    ...(request.near
      ? {
          locationBias: {
            circle: {
              center: {
                latitude: request.near.latitude,
                longitude: request.near.longitude,
              },
              radius: request.radiusMeters ?? 20_000,
            },
          },
        }
      : {}),
  };
}

/** Total: any shape we do not recognise yields no results rather than an error. */
export function toPlaceResults(body: unknown): PlaceResult[] {
  if (typeof body !== 'object' || body === null) return [];
  const places = (body as Record<string, unknown>).places;
  if (!Array.isArray(places)) return [];

  const out: PlaceResult[] = [];
  for (const entry of places) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const providerPlaceId = typeof record.id === 'string' ? record.id : null;
    const displayName = record.displayName as Record<string, unknown> | undefined;
    const name =
      displayName && typeof displayName.text === 'string' ? displayName.text.trim() : null;
    // Both are required: a venue with no id cannot be looked up again, and one
    // with no name cannot be shown to anybody.
    if (!providerPlaceId || !name) continue;

    const address =
      typeof record.formattedAddress === 'string' ? record.formattedAddress.trim() : null;

    out.push({
      providerPlaceId,
      name,
      address: address && address.length > 0 ? address : null,
      coordinates: parseCoordinates(record.location),
    });
  }
  return out;
}

/**
 * Drive time per destination index, in whole minutes.
 *
 * A destination the provider could not route to is `null` rather than missing:
 * downstream treats an unknown journey as "keep it, we do not know", which is
 * not the same as "it is too far".
 */
export function toTravelMinutes(body: unknown, destinationCount: number): (number | null)[] {
  const out: (number | null)[] = new Array(destinationCount).fill(null);
  if (!Array.isArray(body)) return out;

  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const index = record.destinationIndex;
    if (!isFiniteNumber(index) || index < 0 || index >= destinationCount) continue;
    // Anything other than OK — no road, outside coverage — stays null.
    if (record.condition !== undefined && record.condition !== 'ROUTE_EXISTS') continue;

    const duration = record.duration;
    if (typeof duration !== 'string') continue;
    const seconds = Number.parseFloat(duration.replace(/s$/, ''));
    if (!Number.isFinite(seconds)) continue;

    out[index] = Math.round(seconds / 60);
  }
  return out;
}
