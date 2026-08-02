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

import { deleteCalendarEvent, hasCalendarAccess, writeCalendarEvent } from './calendar';
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
  /** Notification copy, already translated on this device, in its owner's language. */
  reminder: { leadMinutes: number; title: string; body: string };
  /** Persist (or clear) this device's event id for a plan. */
  onCalendarEvent: (plan: Plan, eventId: string | null) => Promise<void>;
}

/** Cheap change detector: re-run only when something we act on actually moved. */
function signatureOf(plans: Plan[], profileId: string | null): string {
  return plans
    .map(
      (plan) =>
        `${plan.id}:${plan.status}:${plan.startsAt ?? ''}:${plan.calendarEventIds[profileId ?? ''] ?? ''}`,
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
  const { plans, profileId, timeZone, calendarTitleFor, reminder, onCalendarEvent } = options;
  if (!profileId) return;

  const { toWrite, toRemove } = calendarActions(plans, profileId);

  // Permission is never requested here — that belongs to a screen where the
  // user can see why they are being asked. Without it, this silently does
  // nothing, which is the correct outcome.
  if ((toWrite.length > 0 || toRemove.length > 0) && (await hasCalendarAccess())) {
    for (const plan of toWrite) {
      if (isCancelled() || !plan.startsAt) break;
      const eventId = await writeCalendarEvent({
        title: calendarTitleFor(plan),
        startsAt: new Date(plan.startsAt),
        // A plan with no end is treated as an hour, so the entry has a
        // sensible shape in a week view.
        endsAt: new Date(plan.endsAt ?? new Date(plan.startsAt).getTime() + 3_600_000),
        timeZone,
      });
      if (eventId) await onCalendarEvent(plan, eventId);
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
  const { plans, profileId, enabled } = options;
  const signature = signatureOf(plans, profileId);

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
