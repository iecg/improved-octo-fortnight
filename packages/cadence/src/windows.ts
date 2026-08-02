/**
 * Suggesting open windows.
 *
 * Pure, like the rest of this package. The device layer reads busy blocks from
 * the phone's calendar and hands them here; this decides where a plan could
 * go. Keeping the algorithm out of the native wrapper means it is testable
 * without a device, and — the part that matters for this app — it means the
 * couple's busy times are never marshalled anywhere except through the caller.
 * Only the window they choose is ever written to the server.
 */
import { addDays, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface SuggestWindowsOptions {
  /** Search bounds. */
  from: Date;
  to: Date;
  durationMinutes: number;
  /** Wall-clock hours in the couple's timezone that a suggestion may start within. */
  earliestHour: number;
  latestHour: number;
  timeZone: string;
  limit: number;
}

const MINUTE_MS = 60_000;

/** Sort and coalesce overlapping or touching blocks into a clean timeline. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ start: new Date(range.start), end: new Date(range.end) });
    }
  }
  return merged;
}

/**
 * The instant at a given wall-clock hour on the day containing `anchor`.
 *
 * Exported because picking a plan's start is the same question: "7pm on that
 * day, as the couple reads a clock". Screens must not do this arithmetic
 * themselves — all of it lives in this package, against the couple's timezone.
 */
export function atHourInZone(anchor: Date, hour: number, timeZone: string): Date {
  const zoned = toZonedTime(anchor, timeZone);
  const wall = startOfDay(zoned);
  wall.setHours(hour, 0, 0, 0);
  return fromZonedTime(wall, timeZone);
}

/** Subtract busy blocks from a band, returning what is left. */
function subtract(band: TimeRange, busy: TimeRange[]): TimeRange[] {
  const free: TimeRange[] = [];
  let cursor = band.start;

  for (const block of busy) {
    if (block.end <= band.start || block.start >= band.end) continue;
    if (block.start > cursor) free.push({ start: cursor, end: block.start });
    if (block.end > cursor) cursor = block.end;
    if (cursor >= band.end) break;
  }

  if (cursor < band.end) free.push({ start: cursor, end: band.end });
  return free.filter((range) => range.end > range.start);
}

/**
 * Candidate windows, earliest first.
 *
 * One suggestion per free gap rather than every possible slot inside it: a
 * screen offering forty near-identical times is worse than one offering three.
 */
export function suggestWindows(busy: TimeRange[], options: SuggestWindowsOptions): TimeRange[] {
  const { from, to, durationMinutes, earliestHour, latestHour, timeZone, limit } = options;

  if (durationMinutes <= 0 || limit <= 0 || to <= from) return [];
  if (latestHour <= earliestHour) return [];

  const merged = mergeRanges(busy);
  const durationMs = durationMinutes * MINUTE_MS;
  const suggestions: TimeRange[] = [];

  // Step a day at a time through the search range, in the couple's timezone so
  // the "evenings only" band lands on their evenings, not UTC's.
  let dayCursor = from;
  const guard = 400; // A search range longer than a year is a caller bug.

  for (let day = 0; day < guard && dayCursor < to; day += 1) {
    const bandStart = atHourInZone(dayCursor, earliestHour, timeZone);
    const bandEnd = atHourInZone(dayCursor, latestHour, timeZone);

    const clamped: TimeRange = {
      start: bandStart < from ? from : bandStart,
      end: bandEnd > to ? to : bandEnd,
    };

    if (clamped.end > clamped.start) {
      for (const gap of subtract(clamped, merged)) {
        if (gap.end.getTime() - gap.start.getTime() >= durationMs) {
          suggestions.push({
            start: gap.start,
            end: new Date(gap.start.getTime() + durationMs),
          });
          if (suggestions.length >= limit) return suggestions;
        }
      }
    }

    // Advance by a calendar day in the couple's timezone, so DST does not
    // shift the band by an hour halfway through the search.
    dayCursor = fromZonedTime(addDays(toZonedTime(dayCursor, timeZone), 1), timeZone);
  }

  return suggestions;
}
