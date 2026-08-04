/**
 * Reconciling the phone with the couple's plans.
 *
 * Runs whenever the plan list changes and asks two questions: which booked
 * plans is *this* device missing a calendar event for, and what should be
 * reminding us next. Both are answered by pure functions in `@couple/cadence`;
 * everything here is the native side of it.
 *
 * Reconciliation rather than write-on-accept is forced by the data model —
 * each partner's phone stores its own event id, and the partner who did not
 * tap "accept" was not running any code at that moment.
 *
 * The repository is inverted into `onCalendarEvent` so this package keeps
 * depending only on native modules and pure logic, never on Supabase.
 */
import { calendarActions, plannedReminders } from '@couple/cadence';
import type { Plan } from '@couple/core';
import { useEffect, useRef } from 'react';

import {
  deleteCalendarEvent,
  hasCalendarAccess,
  updateCalendarEvent,
  writeCalendarEvent,
} from './calendar';
import { cancelAllReminders, hasNotificationPermission, scheduleReminder } from './notifications';

export interface DeviceSyncOptions {
  plans: Plan[];
  profileId: string | null;
  timeZone: string;
  /** The couple must be paired and loaded before any of this means anything. */
  enabled: boolean;
  /**
   * What the OS calendar shows. The intimacy app passes a neutral label the
   * user chose; the 2-2-2 app passes the plan's real title. Nothing else about
   * the plan is written either way.
   */
  calendarTitleFor: (plan: Plan) => string;
  /**
   * The address to write into the OS calendar entry, or undefined for none.
   *
   * Optional, and undefined by default, so the intimacy app — which writes a
   * neutral label and nothing else — is unchanged by its existence. The 2-2-2
   * app supplies it only for a plan whose place was explicitly opted in, since
   * a calendar entry syncs to desktops and shared views this app cannot see.
   */
  calendarLocationFor?: (plan: Plan) => string | undefined;
  /** Notification copy, already translated on this device, in its owner's language. */
  reminder: { leadMinutes: number; title: string; body: string };
  /** Persist (or clear) this device's event id for a plan. */
  onCalendarEvent: (plan: Plan, eventId: string | null) => Promise<void>;
}

/**
 * Cheap change detector: re-run only when something we act on actually moved.
 *
 * Includes the title and location the entry *would* carry, not just the plan's
 * own columns, because those are what a pass now writes. Rename a plan or
 * attach a place to it and nothing else about the row changes — under the
 * narrower signature this used to have, the pass never re-ran and the update
 * below could never happen. The resolvers are called rather than compared, so
 * a fresh closure on every render costs nothing here.
 */
function signatureOf(
  plans: Plan[],
  profileId: string | null,
  calendarTitleFor: (plan: Plan) => string,
  calendarLocationFor?: (plan: Plan) => string | undefined,
): string {
  return plans
    .map((plan) =>
      [
        plan.id,
        plan.status,
        plan.startsAt ?? '',
        plan.endsAt ?? '',
        plan.calendarEventIds[profileId ?? ''] ?? '',
        calendarTitleFor(plan),
        calendarLocationFor?.(plan) ?? '',
      ].join(':'),
    )
    .sort()
    .join('|');
}

/**
 * One reconciliation pass. Exported so it can be tested without a renderer.
 *
 * Idempotent by construction: it derives everything from the plans it is
 * handed, so an interrupted pass leaves no state behind and the next one
 * simply picks up whatever is still outstanding. That property is what makes
 * it safe for the hook below to abandon a run whenever the plans change.
 */
export async function reconcileDevice(
  options: DeviceSyncOptions,
  isCancelled: () => boolean,
): Promise<void> {
  const {
    plans,
    profileId,
    timeZone,
    calendarTitleFor,
    calendarLocationFor,
    reminder,
    onCalendarEvent,
  } = options;
  if (!profileId) return;

  const { toWrite, toUpdate, toRemove } = calendarActions(plans, profileId);

  /** The entry a plan should have right now, wherever it is being written. */
  function eventFor(plan: Plan, startsAt: string) {
    // Absent unless the app opted this plan in, so the default entry is still
    // a title, a time, and nothing else.
    const location = calendarLocationFor?.(plan);
    return {
      title: calendarTitleFor(plan),
      startsAt: new Date(startsAt),
      // A plan with no end is treated as an hour, so the entry has a sensible
      // shape in a week view.
      endsAt: new Date(plan.endsAt ?? new Date(startsAt).getTime() + 3_600_000),
      timeZone,
      ...(location ? { location } : {}),
    };
  }

  // Permission is never requested here — that belongs to a screen where the
  // user can see why they are being asked. Without it, this silently does
  // nothing, which is the correct outcome.
  const hasWork = toWrite.length > 0 || toUpdate.length > 0 || toRemove.length > 0;
  if (hasWork && (await hasCalendarAccess())) {
    for (const plan of toWrite) {
      if (isCancelled() || !plan.startsAt) break;
      const eventId = await writeCalendarEvent(eventFor(plan, plan.startsAt));
      if (eventId) await onCalendarEvent(plan, eventId);
    }

    // Bring existing entries back into line. Nothing records what was written
    // last time, so this rewrites rather than diffs — see `calendarActions`.
    // A single failure is skipped rather than abandoning the pass: the event
    // may have been deleted from the Calendar app, which is a reasonable thing
    // for someone to have done and not a reason to stop reconciling.
    for (const [plan, eventId] of toUpdate) {
      if (isCancelled() || !plan.startsAt) break;
      try {
        await updateCalendarEvent(eventId, eventFor(plan, plan.startsAt));
      } catch {
        // Gone from under us. The next pass will notice nothing else changed.
      }
    }

    for (const [plan, eventId] of toRemove) {
      if (isCancelled()) break;
      await deleteCalendarEvent(eventId);
      await onCalendarEvent(plan, null);
    }
  }

  if (isCancelled()) return;

  if (await hasNotificationPermission()) {
    // Rebuild rather than diff: every reminder here is ours, and the plan list
    // is small enough that being obviously correct beats being clever.
    await cancelAllReminders();
    const now = new Date();
    for (const planned of plannedReminders(plans, now, reminder.leadMinutes)) {
      if (isCancelled()) break;
      await scheduleReminder(
        { key: planned.key, title: reminder.title, body: reminder.body, at: planned.at },
        now,
      );
    }
  }
}

export function useDeviceSync(options: DeviceSyncOptions): void {
  const { plans, profileId, enabled, calendarTitleFor, calendarLocationFor } = options;
  const signature = signatureOf(plans, profileId, calendarTitleFor, calendarLocationFor);

  /**
   * The run reads its inputs from here rather than closing over them.
   *
   * `plans` is a fresh array on every refetch and the callbacks are fresh on
   * every render, so listing them as dependencies re-ran the effect constantly.
   * The previous version tried to absorb that with a `lastRun` signature guard,
   * which made it worse: React tears the old effect down *before* the new one
   * runs, so an unrelated re-render cancelled the in-flight pass and the guard
   * then saw the signature already recorded and returned immediately. The work
   * — usually the reminder scheduling, which comes last — was dropped and never
   * retried until a plan happened to change. Depending only on what we act on
   * means a teardown now happens exactly when restarting is the right answer.
   */
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!enabled || !profileId) return;

    let cancelled = false;
    void reconcileDevice(latest.current, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [signature, enabled, profileId]);
}
