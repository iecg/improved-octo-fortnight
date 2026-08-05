/**
 * Places — 2-2-2-app-owned.
 *
 * In its own module behind its own factory, the same way ideas and check-ins
 * are, so the intimacy app has nothing to import even by accident. The factory
 * hard-codes `two_two_two` rather than taking a domain, because there is no
 * second caller and a domain parameter is exactly the shape the boundary rule
 * forbids.
 *
 * Nothing here knows whether a mapping provider is configured. A place typed by
 * hand arrives as `provider: 'manual'` with no coordinates and no provider id,
 * which is the whole feature working with no API key anywhere — a searched
 * place is the same row with three more fields filled in.
 *
 * Note what this does NOT do: it never writes `plans.location`. That column
 * reaches a device calendar, so the projection from a place to a label is an
 * explicit second call the caller makes, not a side effect hidden in here.
 */
import type { Coordinates, Locale, PlaceProvider, PlanPlace } from '@couple/core';
import type { FieldCipher } from '@couple/crypto';

import type { AppSupabaseClient } from './client';
import { toPlanPlace } from './mappers';

const DOMAIN = 'two_two_two';

export interface AttachPlaceInput {
  coupleId: string;
  attachedBy: string;
  /** Exactly one of these; the table enforces it. */
  planId?: string | null;
  ideaId?: string | null;
  /** Stored and shown exactly as written. */
  name: string;
  address?: string | null;
  provider: PlaceProvider;
  providerPlaceId?: string | null;
  coordinates?: Coordinates | null;
  /** The language the address is written in. */
  locale: Locale;
  /** Opt-in, and off unless the caller says otherwise. */
  shareWithCalendar?: boolean;
}

export interface PlaceRepository {
  listForCouple(coupleId: string): Promise<PlanPlace[]>;
  getForPlan(planId: string): Promise<PlanPlace | null>;
  attach(input: AttachPlaceInput): Promise<PlanPlace>;
  setShareWithCalendar(placeId: string, share: boolean): Promise<PlanPlace>;
  detach(placeId: string): Promise<void>;
}

/**
 * Two rules the table used to hold and cannot any more.
 *
 * `plan_places_coords_paired` and `plan_places_google_has_id` were `check`
 * constraints until the columns they policed moved inside the payload. Postgres
 * cannot read a sealed blob, so they live here — the same move the display
 * name's length rule made, and worth the same note: the only party they ever
 * protected against was the couple themselves.
 */
export class InvalidPlaceError extends Error {}

export function createPlaceRepository(
  client: AppSupabaseClient,
  cipher: FieldCipher,
): PlaceRepository {
  if (cipher.scope !== DOMAIN) {
    throw new Error(`places are ${DOMAIN}-owned; got a ${cipher.scope} cipher`);
  }

  return {
    async listForCouple(coupleId) {
      const { data, error } = await client
        .from('plan_places')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('domain', DOMAIN)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toPlanPlace(row, cipher));
    },

    async getForPlan(planId) {
      const { data, error } = await client
        .from('plan_places')
        .select('*')
        .eq('plan_id', planId)
        .eq('domain', DOMAIN)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toPlanPlace(data, cipher) : null;
    },

    async attach(input) {
      // Half a coordinate is not a location, and a searched place with no
      // handle cannot be looked up again. Both used to be the table's job.
      if (
        input.coordinates &&
        (input.coordinates.latitude === null || input.coordinates.longitude === null)
      ) {
        throw new InvalidPlaceError('a coordinate needs both a latitude and a longitude');
      }
      if (input.provider === 'google' && !input.providerPlaceId) {
        throw new InvalidPlaceError('a searched place needs the provider handle it was found by');
      }

      // Minted here because the payload's AAD binds to it.
      const id = cipher.newId();

      const { data, error } = await client
        .from('plan_places')
        .insert({
          id,
          couple_id: input.coupleId,
          domain: DOMAIN,
          plan_id: input.planId ?? null,
          idea_id: input.ideaId ?? null,
          attached_by: input.attachedBy,
          // `provider` and `share_with_calendar` stay outside: one is
          // provenance, the other is a switch this app acts on. Everything
          // that says *where* goes in.
          payload: cipher.seal(
            {
              name: input.name,
              address: input.address ?? null,
              providerPlaceId: input.providerPlaceId ?? null,
              latitude: input.coordinates?.latitude ?? null,
              longitude: input.coordinates?.longitude ?? null,
              locale: input.locale,
            },
            { table: 'plan_places', coupleId: input.coupleId, id },
          ),
          provider: input.provider,
          share_with_calendar: input.shareWithCalendar ?? false,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPlanPlace(data, cipher);
    },

    async setShareWithCalendar(placeId, share) {
      const { data, error } = await client
        .from('plan_places')
        .update({ share_with_calendar: share })
        .eq('id', placeId)
        .eq('domain', DOMAIN)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPlanPlace(data, cipher);
    },

    async detach(placeId) {
      const { error } = await client
        .from('plan_places')
        .delete()
        .eq('id', placeId)
        .eq('domain', DOMAIN);
      if (error) throw new Error(error.message);
    },
  };
}
