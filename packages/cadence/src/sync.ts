/**
 * Deciding what the device needs to do — pure, so it can be tested without a
 * phone.
 *
 * Calendar and reminder state is *reconciled*, not written once at the moment
 * of acceptance. That is forced by the data model: each partner's phone stores
 * its own event id under its own `profile_id`, and the partner who did not tap
 * "accept" was not running any code at that moment. So every device asks the
 * same question on load — "which booked plans am I missing an event for?" —
 * and both converge without either needing to have been present.
 *
 * The same reasoning covers a reinstall, a second device, and a plan accepted
 * while one phone was offline.
 */
import type { Plan, PlanStatus } from '@couple/core';

/** Statuses where a calendar entry should exist. */
const BOOKED: readonly PlanStatus[] = ['scheduled'];

/**
 * Statuses where an entry that already exists should stay. A completed plan
 * happened — deleting it would rewrite the couple's history.
 */
const KEEP_IF_PRESENT: readonly PlanStatus[] = ['scheduled', 'completed'];

export interface CalendarActions {
  /** Booked plans this device has no event for yet. */
  toWrite: Plan[];
  /**
   * `[plan, eventId]` for entries that exist and should be brought back into
   * line with the plan.
   *
   * Every still-booked plan with an entry, rather than only the ones that
   * changed: nothing records what was actually written to the OS calendar, so
   * there is nothing to compare against. Rewriting unconditionally is the
   * version with no state to get wrong, and a couple has a handful of upcoming
   * plans rather than thousands.
   *
   * Without this, an entry was written once and then frozen. Move a date night,
   * rename it, or attach a place to it, and the phone kept showing whatever was
   * true the first time — which is worse than showing nothing, because it is
   * confidently wrong.
   */
  toUpdate: Array<[Plan, string]>;
  /** `[plan, eventId]` for entries that should no longer exist. */
  toRemove: Array<[Plan, string]>;
}

export function calendarActions(plans: Plan[], profileId: string): CalendarActions {
  const toWrite: Plan[] = [];
  const toUpdate: Array<[Plan, string]> = [];
  const toRemove: Array<[Plan, string]> = [];

  for (const plan of plans) {
    const eventId = plan.calendarEventIds[profileId];

    if (!eventId) {
      if (BOOKED.includes(plan.status) && plan.startsAt) toWrite.push(plan);
      continue;
    }

    // Declined, skipped, or pushed back to a proposal: the entry is now a lie.
    if (!KEEP_IF_PRESENT.includes(plan.status)) {
      toRemove.push([plan, eventId]);
      continue;
    }

    // Still booked, and still has a time to be booked at. A completed plan is
    // history and is left exactly as it was.
    if (BOOKED.includes(plan.status) && plan.startsAt) toUpdate.push([plan, eventId]);
  }

  return { toWrite, toUpdate, toRemove };
}

export interface PlannedReminder {
  /** Stable per plan, so rescheduling replaces rather than stacks. */
  key: string;
  planId: string;
  at: Date;
}

/**
 * Reminders for upcoming booked plans.
 *
 * Only future ones: a phone that was off for a week must not buzz five times
 * on wake. The lead time is a caller's choice because the two apps want
 * different ones — a date night is worth a few hours' warning, a standing
 * weekly slot is not.
 */
export function plannedReminders(plans: Plan[], now: Date, leadMinutes: number): PlannedReminder[] {
  const reminders: PlannedReminder[] = [];

  for (const plan of plans) {
    if (!BOOKED.includes(plan.status) || !plan.startsAt) continue;

    const startsAt = new Date(plan.startsAt);
    if (Number.isNaN(startsAt.getTime())) continue;

    const at = new Date(startsAt.getTime() - leadMinutes * 60_000);
    if (at <= now) continue;

    reminders.push({ key: `plan.${plan.id}`, planId: plan.id, at });
  }

  return reminders.sort((a, b) => a.at.getTime() - b.at.getTime());
}
