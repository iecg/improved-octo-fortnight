/**
 * Row -> domain object.
 *
 * Postgres speaks snake_case and the app speaks camelCase; converting in one
 * place means no screen ever sees a raw row, and renaming a column is a change
 * to this file rather than a search across the codebase.
 *
 * It is also where every payload is opened. That is deliberate: decryption
 * happening in exactly one place is what makes "no screen ever sees ciphertext"
 * checkable rather than hoped for.
 *
 * **These functions never throw.** A single unopenable row would otherwise take
 * down a whole list, and the right failure for someone looking at their own
 * history is a greyed-out placeholder, not a screen that fails to render. Each
 * mapper sets `unreadable` instead and leaves the private fields empty. In
 * normal operation it is never true — the router does not reach a screen that
 * lists rows before the couple key is in hand.
 */
import {
  CHECKIN_INTERESTS,
  COST_BANDS,
  LOCALES,
  type AppDomain,
  type BusyWindow,
  type Cadence,
  type Checkin,
  type CheckinInterest,
  type Coordinates,
  type CostBand,
  type Couple,
  type IdeaSource,
  type Locale,
  type PlaceProvider,
  type Plan,
  type PlanIdea,
  type PlanPlace,
  type PlanProposal,
  type Profile,
} from '@couple/core';
import type { FieldCipher, RecordIdentity } from '@couple/crypto';

import type { Database, Json } from './database.types';

type Tables = Database['public']['Tables'];
type Views = Database['public']['Views'];
type Fields = Record<string, unknown> | null;

function open(cipher: FieldCipher, blob: string, identity: RecordIdentity): Fields {
  try {
    return cipher.open(blob, identity);
  } catch {
    return null;
  }
}

function text(fields: Fields, key: string): string | null {
  const value = fields?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * A token is only a token if the catalog still recognises it. Anything else is
 * treated as absent rather than passed through to a translation lookup, which
 * would render as raw dot-notation on someone's screen.
 */
function token<T extends string>(fields: Fields, key: string, catalog: readonly T[]): T | null {
  const value = fields?.[key];
  return typeof value === 'string' && (catalog as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function toProfile(
  row: Tables['profiles']['Row'],
  cipher: FieldCipher,
  coupleId: string | null,
): Profile {
  // No couple means no key and no name — there is nobody to be addressed by
  // yet, so this is the ordinary state before pairing rather than a failure.
  if (coupleId === null || row.name_payload === null) {
    return {
      id: row.id,
      displayName: null,
      timezone: row.timezone,
      locale: row.locale,
      unreadable: false,
    };
  }

  const fields = open(cipher, row.name_payload, {
    table: 'profiles',
    coupleId,
    profileId: row.id,
  });

  return {
    id: row.id,
    displayName: text(fields, 'displayName'),
    timezone: row.timezone,
    locale: row.locale,
    unreadable: fields === null,
  };
}

export function toCouple(row: Tables['couples']['Row']): Couple {
  return {
    id: row.id,
    inviteCode: row.invite_code,
    anniversaryDate: row.anniversary_date,
    timezone: row.timezone,
    createdAt: row.created_at,
  };
}

/** No private fields, so no cipher. */
export function toCadence(row: Tables['cadences']['Row']): Cadence {
  return {
    id: row.id,
    coupleId: row.couple_id,
    domain: row.domain as AppDomain,
    kind: row.kind,
    intervalValue: row.interval_value,
    intervalUnit: row.interval_unit,
    enabled: row.enabled,
  };
}

/**
 * `calendar_event_ids` is jsonb, so the driver hands back `Json`. Anything
 * that is not a flat string map is treated as absent rather than trusted —
 * this value comes back into `Calendar.getEventAsync`.
 */
function toCalendarEventIds(value: Json): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [profileId, eventId] of Object.entries(value)) {
    if (typeof eventId === 'string') out[profileId] = eventId;
  }
  return out;
}

export function toPlan(row: Tables['plans']['Row'], cipher: FieldCipher): Plan {
  const fields = open(cipher, row.payload, {
    table: 'plans',
    coupleId: row.couple_id,
    id: row.id,
  });

  return {
    id: row.id,
    coupleId: row.couple_id,
    domain: row.domain as AppDomain,
    kind: row.kind,
    title: text(fields, 'title'),
    notes: text(fields, 'notes'),
    location: text(fields, 'location'),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    createdBy: row.created_by,
    completedAt: row.completed_at,
    calendarEventIds: toCalendarEventIds(row.calendar_event_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    unreadable: fields === null,
  };
}

/** No private fields: a proposal is two timestamps and an answer. */
export function toPlanProposal(row: Tables['plan_proposals']['Row']): PlanProposal {
  return {
    id: row.id,
    planId: row.plan_id,
    proposedBy: row.proposed_by,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    response: row.response,
    respondedAt: row.responded_at,
    counteredFrom: row.countered_from,
    createdAt: row.created_at,
  };
}

export function toPlanIdea(row: Tables['plan_ideas']['Row'], cipher: FieldCipher): PlanIdea {
  const fields = open(cipher, row.payload, {
    table: 'plan_ideas',
    coupleId: row.couple_id,
    id: row.id,
  });

  return {
    id: row.id,
    coupleId: row.couple_id,
    domain: row.domain as AppDomain,
    kind: row.kind,
    // The only non-null content field in the schema, so it needs a stand-in
    // when the payload will not open. Empty renders as nothing rather than as
    // someone else's words.
    title: text(fields, 'title') ?? '',
    summary: text(fields, 'summary'),
    url: text(fields, 'url'),
    estCostBand: token<CostBand>(fields, 'estCostBand', COST_BANDS),
    source: row.source as IdeaSource,
    sourceDomain: row.source_domain,
    locale: token<Locale>(fields, 'locale', LOCALES) ?? 'en',
    savedBy: row.saved_by,
    createdAt: row.created_at,
    unreadable: fields === null,
  };
}

/**
 * Coordinates come out of the payload now rather than out of two `numeric`
 * columns, so they arrive as whatever JSON carried — but the coercion stays.
 * It cost nothing and it is the only thing standing between a caller and
 * string arithmetic on `"41.385064"` if a payload was ever written by hand.
 *
 * A half-set pair is treated as no coordinate at all. The table used to forbid
 * it with a `check`; that constraint could not survive the columns moving
 * inside the blob, so this mapper is now the only thing enforcing it on read.
 */
function toCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  if (
    latitude === null ||
    longitude === null ||
    latitude === undefined ||
    longitude === undefined
  ) {
    return null;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { latitude: lat, longitude: lng };
}

export function toPlanPlace(row: Tables['plan_places']['Row'], cipher: FieldCipher): PlanPlace {
  const fields = open(cipher, row.payload, {
    table: 'plan_places',
    coupleId: row.couple_id,
    id: row.id,
  });

  return {
    id: row.id,
    coupleId: row.couple_id,
    domain: row.domain as AppDomain,
    planId: row.plan_id,
    ideaId: row.idea_id,
    name: text(fields, 'name') ?? '',
    address: text(fields, 'address'),
    provider: row.provider as PlaceProvider,
    providerPlaceId: text(fields, 'providerPlaceId'),
    coordinates: toCoordinates(fields?.latitude, fields?.longitude),
    locale: token<Locale>(fields, 'locale', LOCALES) ?? 'en',
    shareWithCalendar: row.share_with_calendar,
    attachedBy: row.attached_by,
    createdAt: row.created_at,
    unreadable: fields === null,
  };
}

export function toCheckin(row: Tables['checkins']['Row'], cipher: FieldCipher): Checkin {
  const fields = open(cipher, row.payload, {
    table: 'checkins',
    coupleId: row.couple_id,
    profileId: row.profile_id,
    onDate: row.on_date,
  });

  return {
    id: row.id,
    coupleId: row.couple_id,
    profileId: row.profile_id,
    onDate: row.on_date,
    // Null rather than a default. There is no honest stand-in for an answer
    // nobody can read, and inventing one would put words in a partner's mouth
    // — which is the one thing this table must never do.
    interest: token<CheckinInterest>(fields, 'interest', CHECKIN_INTERESTS),
    note: text(fields, 'note'),
    createdAt: row.created_at,
    unreadable: fields === null,
  };
}

/**
 * The one mapper over a view rather than a table.
 *
 * Returns `Date`s rather than the ISO strings every other mapper passes
 * through, because the only consumer is the cadence engine's range arithmetic
 * and handing it strings would push the parsing into a screen.
 */
export function toBusyWindow(row: Views['plan_busy_times']['Row']): BusyWindow {
  return { start: new Date(row.starts_at), end: new Date(row.ends_at) };
}
