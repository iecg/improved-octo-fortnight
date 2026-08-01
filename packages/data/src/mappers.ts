/**
 * Row -> domain object.
 *
 * Postgres speaks snake_case and the app speaks camelCase; converting in one
 * place means no screen ever sees a raw row, and renaming a column is a change
 * to this file rather than a search across the codebase.
 */
import type {
  AppDomain,
  Cadence,
  Checkin,
  Couple,
  Plan,
  PlanProposal,
  Profile,
} from '@couple/core';

import type { Database, Json } from './database.types';

type Tables = Database['public']['Tables'];

export function toProfile(row: Tables['profiles']['Row']): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    timezone: row.timezone,
    locale: row.locale,
    expoPushToken: row.expo_push_token,
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
