/**
 * Device calendar access.
 *
 * Two properties this app depends on:
 *
 *  - Each partner's phone writes its own event, so the title lands in that
 *    partner's language with no translation step anywhere.
 *  - Nothing intimate is written into the event. The calendar is visible to
 *    anyone holding an unlocked phone, and on a shared Mac it syncs to a
 *    desktop. The title is a neutral label the user chooses; notes and
 *    location are omitted unless explicitly opted into.
 *
 * SDK 57 replaced the `*Async` free functions with an object-oriented API —
 * the old names still exist but throw when imported from `expo-calendar`.
 */
import * as Calendar from 'expo-calendar';
import type { EntityTypes } from 'expo-calendar/legacy';

import type { TimeRange } from '@couple/core';

/** `EntityTypes.EVENT`, without importing the legacy module for one constant. */
const EVENT_ENTITY = 'event' as EntityTypes;

export interface CalendarEventInput {
  /** Neutral label shown in the OS calendar. Never the plan's real title. */
  title: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  /**
   * Opt-in only, and the single field that ever carries anything beyond a
   * label and a span.
   *
   * There is deliberately no `notes`. Invariant 3 says nothing intimate
   * reaches a calendar entry, and a plan's notes are the most intimate thing
   * it has; the field used to exist here, unset by every caller, as an escape
   * hatch for a rule that has no exceptions. Leaving it out is the version the
   * type checker enforces.
   */
  location?: string;
}

export async function hasCalendarAccess(): Promise<boolean> {
  const { granted } = await Calendar.getCalendarPermissions();
  return granted;
}

export async function requestCalendarAccess(): Promise<boolean> {
  const { granted } = await Calendar.requestCalendarPermissions();
  return granted;
}

/**
 * A calendar we are allowed to write to.
 *
 * iOS exposes a default calendar; Android does not, so fall back to the first
 * modifiable one.
 */
export async function findWritableCalendar(): Promise<Calendar.ExpoCalendar | null> {
  const calendars = await Calendar.getCalendars(EVENT_ENTITY);
  return calendars.find((calendar) => calendar.allowsModifications) ?? null;
}

/** Returns the new event's id, or null when there is nowhere to write it. */
export async function writeCalendarEvent(input: CalendarEventInput): Promise<string | null> {
  const calendar = await findWritableCalendar();
  if (!calendar) return null;

  const event = await calendar.createEvent({
    title: input.title,
    startDate: input.startsAt,
    endDate: input.endsAt,
    timeZone: input.timeZone,
    ...(input.location ? { location: input.location } : {}),
  });

  return event.id;
}

/**
 * Bring an existing entry back into line with a plan.
 *
 * `location` is named on every call and passed as `null` when absent. Where
 * `writeCalendarEvent` may simply omit it, this may not: `update()` is a
 * *partial merge*, so a key that is absent leaves the field as it was.
 * Spreading it away asked the OS to keep whatever was there rather than to
 * clear it.
 *
 * That made the calendar opt-in one-way. Turning "show this address in my
 * calendar" back off flipped the flag, re-ran a pass, rewrote the title and the
 * time — and left the address on the phone, and in whatever desktop or family
 * calendar it syncs to, for as long as the plan stayed booked. Detaching the
 * place did the same. The app agreed with the user and the device did not.
 *
 * Passing `null` is the whole fix: the SDK's own wrapper collects every key
 * whose value is null and forwards them as the `nullableFields` argument the
 * native side needs (`expo-calendar/build/utils.js`). That argument is not on
 * the public signature, so it cannot be passed directly.
 *
 * No test in Node can reach this: the module is mocked in every suite that
 * exercises reconciliation, and the bug is in the argument shape the real
 * module hands to Expo. Section I of `docs/manual-verification.md` is where it
 * is checked.
 */
export async function updateCalendarEvent(
  eventId: string,
  input: CalendarEventInput,
): Promise<void> {
  const event = await Calendar.ExpoCalendarEvent.get(eventId);
  await event.update({
    title: input.title,
    startDate: input.startsAt,
    endDate: input.endsAt,
    location: input.location ?? null,
  });
}

/**
 * Remove an event. Missing events are not an error: the user may have deleted
 * it from the Calendar app, which is a perfectly reasonable thing to do.
 */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  try {
    const event = await Calendar.ExpoCalendarEvent.get(eventId);
    await event.delete();
  } catch {
    // Already gone.
  }
}

/**
 * Busy blocks from every calendar on the device, for suggesting open windows.
 *
 * This data never leaves the phone — it is passed straight to `suggestWindows`
 * in `@couple/cadence`, and only the window the couple picks is sent to the
 * server. All-day events are ignored: "on holiday" should not block an evening.
 */
export async function readBusyBlocks(from: Date, to: Date): Promise<TimeRange[]> {
  const calendars = await Calendar.getCalendars(EVENT_ENTITY);
  if (calendars.length === 0) return [];

  const events = await Calendar.listEvents(calendars, from, to);

  return events
    .filter((event) => !event.allDay)
    .map((event) => ({
      start: new Date(event.startDate),
      end: new Date(event.endDate),
    }))
    .filter((range) => !Number.isNaN(range.start.getTime()) && !Number.isNaN(range.end.getTime()));
}
