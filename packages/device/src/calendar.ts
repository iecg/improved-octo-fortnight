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
  /** Opt-in only; omitted by default so the calendar reveals nothing. */
  notes?: string;
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
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.location ? { location: input.location } : {}),
  });

  return event.id;
}

export async function updateCalendarEvent(
  eventId: string,
  input: CalendarEventInput,
): Promise<void> {
  const event = await Calendar.ExpoCalendarEvent.get(eventId);
  await event.update({
    title: input.title,
    startDate: input.startsAt,
    endDate: input.endsAt,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.location ? { location: input.location } : {}),
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
