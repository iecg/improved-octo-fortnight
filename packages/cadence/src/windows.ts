/**
 * Suggesting open windows.
 *
 * Pure, like the rest of this package. Busy blocks arrive from the caller —
 * the phone's calendar, the couple's own plans, the redacted server view — and
 * this decides where a plan could go. Keeping the algorithm out of the native
 * wrapper means it is testable without a device, and — the part that matters
 * for this app — it means the couple's busy times are never marshalled
 * anywhere except through the caller. Only the window they choose is ever
 * written to the server.
 */
import type { Plan, PlanStatus, TimeRange } from '@couple/core';
import { addDays, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

// Re-exported so callers that already reach for the engine's vocabulary keep
// working; the declaration itself lives in `@couple/core`.
export type { TimeRange };

/**
 * Statuses that occupy time.
 *
 * Deliberately **not** `BOOKED` from `./sync`, and the difference is the whole
 * point. `BOOKED` decides what earns a calendar entry and a reminder, and a
 * time nobody has agreed to earns neither — a proposal is a question, and
 * putting a question on a shared calendar or firing a notification about it
 * would answer it on the couple's behalf.
 *
 * Occupying time is a weaker claim than being booked. A window under
 * negotiation is exactly the one you do not want the other app to offer, so it
 * counts here and nowhere else. `completed` and `skipped` are behind us;
 * `idea` and `declined` were never a commitment.
 */
export const BUSY_STATUSES: readonly PlanStatus[] = ['proposed', 'scheduled'];

/**
 * The couple's own plans as busy blocks.
 *
 * Costs nothing — every screen that needs this already holds its plans in a
 * query — and it is what lets free/busy work at all on a phone where calendar
 * access was refused. Plans without both endpoints are not yet a time.
 */
export function busyFromPlans(plans: Plan[]): TimeRange[] {
  const busy: TimeRange[] = [];
  for (const plan of plans) {
    if (!BUSY_STATUSES.includes(plan.status)) continue;
    if (!plan.startsAt || !plan.endsAt) continue;
    const start = new Date(plan.startsAt);
    const end = new Date(plan.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end <= start) continue;
    busy.push({ start, end });
  }
  return busy;
}

/** What a plans screen shows, in the three groups it shows them in. */
export interface GroupedPlans {
  /**
   * Booked, and the time has passed with nobody saying whether it happened.
   *
   * This group is why the function exists. Both apps filtered `upcoming` on
   * `startsAt >= now` and `history` on `completed || skipped`, so a plan that
   * was still `scheduled` after its own end time fell through both and became
   * invisible — the couple could not mark it done because they could not see
   * it. It is not a cosmetic gap: `computeCadenceStatus` re-anchors on
   * completion, so an unanswered plan means that clock never resets, and the
   * ritual reads as more overdue every day because of a plan that already
   * happened.
   *
   * Newest first: the thing you most recently did is the one you can answer.
   */
  needsAnswer: Plan[];
  /** Booked and still ahead, soonest first. */
  upcoming: Plan[];
  /** Answered — done or skipped — newest first. */
  history: Plan[];
}

/** Sortable instant for a plan, or `null` when it has no time yet. */
function startOf(plan: Plan): number | null {
  if (!plan.startsAt) return null;
  const at = new Date(plan.startsAt).getTime();
  return Number.isNaN(at) ? null : at;
}

/**
 * Split a couple's plans into the groups a plans screen renders.
 *
 * Pure, and `now` is an argument like everywhere else in this package — which
 * is also what makes the boundary between "ahead" and "behind" testable at all.
 *
 * A plan counts as behind once it has *ended*, not once it has started: asking
 * "did this happen?" about an evening the couple is currently out on would be
 * absurd. With no `endsAt` the start is the whole of it.
 *
 * Lived in both apps' `plans.tsx` as identical `useMemo` blocks before this,
 * which is how they came to share a bug.
 */
export function groupPlans(plans: Plan[], now: Date): GroupedPlans {
  const at = now.getTime();
  const needsAnswer: Plan[] = [];
  const upcoming: Plan[] = [];
  const history: Plan[] = [];

  for (const plan of plans) {
    if (plan.status === 'completed' || plan.status === 'skipped') {
      history.push(plan);
      continue;
    }
    if (plan.status !== 'scheduled') continue;

    const start = startOf(plan);
    // Booked with no time on it cannot be behind, so it waits with the rest.
    if (start === null) {
      upcoming.push(plan);
      continue;
    }
    const parsedEnd = plan.endsAt ? new Date(plan.endsAt).getTime() : start;
    const end = Number.isNaN(parsedEnd) ? start : parsedEnd;
    if (end < at) needsAnswer.push(plan);
    else upcoming.push(plan);
  }

  const byStart = (a: Plan, b: Plan) => (startOf(a) ?? 0) - (startOf(b) ?? 0);
  needsAnswer.sort((a, b) => byStart(b, a));
  upcoming.sort(byStart);
  history.sort((a, b) => byStart(b, a));

  return { needsAnswer, upcoming, history };
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

/**
 * Whether a candidate collides with anything already booked.
 *
 * The other direction from `suggestWindows`: that one asks "where could this
 * go", this one asks "is this particular time taken". A screen that offers
 * fixed choices rather than searching for them needs the second question, and
 * answering it here keeps every screen's idea of "busy" the same one.
 *
 * Half-open, matching `mergeRanges` — a block ending exactly when the
 * candidate starts is back-to-back, not a conflict.
 */
export function overlapsAny(candidate: TimeRange, busy: TimeRange[]): boolean {
  if (candidate.end <= candidate.start) return false;
  return busy.some((block) => block.start < candidate.end && block.end > candidate.start);
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
