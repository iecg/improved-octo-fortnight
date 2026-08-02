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

export function useDeviceSync(options: DeviceSyncOptions): void {
  const { plans, profileId, timeZone, enabled, calendarTitleFor, reminder, onCalendarEvent } =
    options;

  const signature = signatureOf(plans, profileId);
  const lastRun = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !profileId) return;
    if (lastRun.current === signature) return;
    lastRun.current = signature;

    let cancelled = false;

    void (async () => {
      const { toWrite, toRemove } = calendarActions(plans, profileId);

      // Permission is never requested here — that belongs to a screen where
      // the user can see why they are being asked. Without it, this silently
      // does nothing, which is the correct outcome.
      if ((toWrite.length > 0 || toRemove.length > 0) && (await hasCalendarAccess())) {
        for (const plan of toWrite) {
          if (cancelled || !plan.startsAt) break;
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
          if (cancelled) break;
          await deleteCalendarEvent(eventId);
          await onCalendarEvent(plan, null);
        }
      }

      if (cancelled) return;

      if (await hasNotificationPermission()) {
        // Rebuild rather than diff: every reminder here is ours, and the plan
        // list is small enough that being obviously correct beats being clever.
        await cancelAllReminders();
        const now = new Date();
        for (const planned of plannedReminders(plans, now, reminder.leadMinutes)) {
          if (cancelled) break;
          await scheduleReminder(
            {
              key: planned.key,
              title: reminder.title,
              body: reminder.body,
              at: planned.at,
            },
            now,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature, enabled, profileId, plans, timeZone, calendarTitleFor, reminder, onCalendarEvent]);
}
