/**
 * Row -> domain object.
 *
 * Postgres speaks snake_case and the app speaks camelCase; converting in one
 * place means no screen ever sees a raw row, and renaming a column is a change
 * to this file rather than a search across the codebase.
 */
import type {
  AppDomain,
  BusyWindow,
  Cadence,
  Checkin,
  Coordinates,
  CostBand,
  Couple,
  IdeaSource,
  Plan,
  PlaceProvider,
  PlanIdea,
  PlanPlace,
  PlanProposal,
  Profile,
} from '@couple/core';

import type { Database, Json } from './database.types';

type Tables = Database['public']['Tables'];
type Views = Database['public']['Views'];

export function toProfile(row: Tables['profiles']['Row']): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    timezone: row.timezone,
    locale: row.locale,
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

export function toPlan(row: Tables['plans']['Row']): Plan {
  return {
    id: row.id,
    coupleId: row.couple_id,
    domain: row.domain as AppDomain,
    kind: row.kind,
    title: row.title,
    notes: row.notes,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    createdBy: row.created_by,
    completedAt: row.completed_at,
    calendarEventIds: toCalendarEventIds(row.calendar_event_ids),
    createdAt: row.created_at,
  };
}

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

export function toPlanIdea(row: Tables['plan_ideas']['Row']): PlanIdea {
  return {
    id: row.id,
    coupleId: row.couple_id,
    domain: row.domain as AppDomain,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    url: row.url,
    estCostBand: row.est_cost_band as CostBand | null,
    source: row.source as IdeaSource,
    sourceDomain: row.source_domain,
    locale: row.locale,
    savedBy: row.saved_by,
    createdAt: row.created_at,
  };
}

/**
 * `latitude` and `longitude` are `numeric`, which both PostgREST and
 * node-postgres hand back as *strings* rather than lose precision on a float.
 * Coercing here — and treating anything unparseable as absent — keeps every
 * caller from silently doing string arithmetic on `"41.385064"`.
 *
 * A half-set pair is treated as no coordinate at all. The table forbids it, but
 * this mapper is what the rest of the app trusts.
 */
function toCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  if (latitude === null || longitude === null || latitude === undefined || longitude === undefined) {
    return null;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { latitude: lat, longitude: lng };
}

export function toPlanPlace(row: Tables['plan_places']['Row']): PlanPlace {
  return {
    id: row.id,
    coupleId: row.couple_id,
    domain: row.domain as AppDomain,
    planId: row.plan_id,
    ideaId: row.idea_id,
    name: row.name,
    address: row.address,
    provider: row.provider as PlaceProvider,
    providerPlaceId: row.provider_place_id,
    coordinates: toCoordinates(row.latitude, row.longitude),
    locale: row.locale,
    shareWithCalendar: row.share_with_calendar,
    attachedBy: row.attached_by,
    createdAt: row.created_at,
  };
}

export function toCheckin(row: Tables['checkins']['Row']): Checkin {
  return {
    id: row.id,
    coupleId: row.couple_id,
    profileId: row.profile_id,
    onDate: row.on_date,
    interest: row.interest,
    energy: row.energy,
    note: row.note,
    createdAt: row.created_at,
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
