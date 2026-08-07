/**
 * The cadence engine.
 *
 * Pure functions only: no I/O, no React, no i18n, no `new Date()`. Every
 * result is structured data or a translation *key* — never a user-facing
 * string — because the two partners may read the same row in different
 * languages.
 *
 * All arithmetic goes through the couple's timezone. Adding "1 week" to a
 * Sunday 20:00 must land on Sunday 20:00, even when a DST transition sits in
 * between, so intervals are applied to wall-clock fields and converted back to
 * an instant rather than by adding milliseconds.
 */
import type { Cadence, IntervalUnit, Plan } from '@couple/core';
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  startOfDay,
} from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export type CadenceHealth = 'on_track' | 'due_soon' | 'overdue';

export interface CadenceStatus {
  domain: string;
  kind: string;
  /** When this ritual last actually happened, or null with no history. */
  lastCompletedAt: Date | null;
  /**
   * Who booked that last one — the profile id from its `created_by`.
   *
   * Null with no history, and null when the person who booked it has since
   * left the couple: `created_by` is `on delete set null`, so a departed
   * partner's plans survive with no author. Both cases mean the same thing to
   * a caller — there is nobody to take a turn after.
   */
  lastCompletedBy: string | null;
  /**
   * What `nextDueAt` was measured from: the last occurrence, or the couple's
   * start date when there is none.
   */
  anchorAt: Date;
  nextDueAt: Date;
  /** Calendar days in the couple's timezone. Negative once overdue. */
  daysUntilDue: number;
  health: CadenceHealth;
  /** 0 at the anchor, 1 at the due date. Clamped. */
  progress: number;
  /** The soonest upcoming plan of this kind that is already booked. */
  nextScheduledAt: Date | null;
  /**
   * True when something is on the calendar that covers this cycle. A scheduled
   * plan keeps `health` at `on_track`, but it does not move `anchorAt` — the
   * clock only resets when the plan is marked completed.
   */
  satisfiedByScheduled: boolean;
}

/** Fraction of an interval remaining at which a ritual starts warning. */
const DUE_SOON_RATIO = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Add an interval in wall-clock terms within `timeZone`.
 *
 * Converting to zoned fields, adding, and converting back is what makes this
 * DST-correct: `addWeeks` operates on calendar fields, so 20:00 stays 20:00
 * even when the offset changed underneath.
 */
export function addInterval(
  instant: Date,
  value: number,
  unit: IntervalUnit,
  timeZone: string,
): Date {
  const zoned = toZonedTime(instant, timeZone);
  let advanced: Date;
  switch (unit) {
    case 'day':
      advanced = addDays(zoned, value);
      break;
    case 'week':
      advanced = addWeeks(zoned, value);
      break;
    case 'month':
      advanced = addMonths(zoned, value);
      break;
    case 'year':
      advanced = addYears(zoned, value);
      break;
  }
  return fromZonedTime(advanced, timeZone);
}

/** Calendar-day difference as the couple would count it on a wall calendar. */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  return differenceInCalendarDays(toZonedTime(to, timeZone), toZonedTime(from, timeZone));
}

/**
 * The next `weekday` (0 = Sunday, matching `Date#getDay`) at or after `from`,
 * counted on the couple's wall calendar.
 *
 * What the booking screen's "this weekend" is built on. Returns `from`'s own
 * day when it already is that weekday, which is the reading someone standing on
 * a Saturday expects — "this weekend" means today, not in seven days.
 *
 * Zoned rather than local: the weekday of an instant is a question about a
 * calendar, and 23:00 Friday in Madrid is already Saturday in Auckland. Reading
 * `getDay()` off the raw instant would put the couple's weekend on the server's.
 */
export function nextWeekdayInZone(from: Date, weekday: number, timeZone: string): Date {
  const zoned = toZonedTime(from, timeZone);
  const ahead = (weekday - zoned.getDay() + 7) % 7;
  return ahead === 0 ? from : fromZonedTime(addDays(zoned, ahead), timeZone);
}

/**
 * Days until the couple's next anniversary, counted on their wall calendar.
 *
 * The anniversary is a calendar date (`YYYY-MM-DD`); only its month and day
 * matter for the recurrence. Returns the count to its next occurrence at or
 * after the couple's today — `0` on the day itself. Pure: `now` and the
 * timezone are arguments, never a clock read. A Feb-29 anniversary falls on
 * Mar 1 in common years, following `Date`'s own rollover.
 */
export function nextAnniversaryDays(anniversaryDate: string, now: Date, timeZone: string): number {
  const [, month = 1, day = 1] = anniversaryDate.split('-').map(Number);
  const today = startOfDay(toZonedTime(now, timeZone));
  let occurrence = startOfDay(new Date(today.getFullYear(), month - 1, day));
  if (occurrence < today) {
    occurrence = startOfDay(new Date(today.getFullYear() + 1, month - 1, day));
  }
  return differenceInCalendarDays(occurrence, today);
}

/**
 * When a plan actually happened. `startsAt` is the real event time; `completedAt`
 * is only when someone remembered to tick the box, so it is the fallback.
 */
function occurredAt(plan: Plan): Date | null {
  const raw = plan.startsAt ?? plan.completedAt;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function matches(plan: Plan, cadence: Cadence): boolean {
  return plan.domain === cadence.domain && plan.kind === cadence.kind;
}

export interface ComputeCadenceStatusInput {
  cadence: Cadence;
  /** All of the couple's plans; filtered to this cadence internally. */
  plans: Plan[];
  now: Date;
  coupleCreatedAt: Date;
  timeZone: string;
}

export function computeCadenceStatus(input: ComputeCadenceStatusInput): CadenceStatus {
  const { cadence, plans, now, coupleCreatedAt, timeZone } = input;
  const relevant = plans.filter((plan) => matches(plan, cadence));

  // The plan itself, not just its date: `created_by` is what the planning
  // rotation reads, and it has to come from the same row the anchor does.
  const lastCompleted = relevant
    .filter((plan) => plan.status === 'completed')
    .map((plan) => ({ plan, at: occurredAt(plan) }))
    .filter((entry): entry is { plan: Plan; at: Date } => entry.at !== null)
    .reduce<{ plan: Plan; at: Date } | null>(
      (latest, entry) => (latest === null || entry.at > latest.at ? entry : latest),
      null,
    );

  const lastCompletedAt = lastCompleted?.at ?? null;
  const lastCompletedBy = lastCompleted?.plan.createdBy ?? null;

  // With no history the couple's start date is the anchor, so a brand new
  // couple gets a full interval before anything reads as overdue.
  const anchorAt = lastCompletedAt ?? coupleCreatedAt;
  const nextDueAt = addInterval(anchorAt, cadence.intervalValue, cadence.intervalUnit, timeZone);

  const nextScheduledAt = relevant
    .filter((plan) => plan.status === 'scheduled')
    .map(occurredAt)
    .filter((date): date is Date => date !== null && date >= now)
    .reduce<Date | null>(
      (soonest, date) => (soonest === null || date < soonest ? date : soonest),
      null,
    );

  const isOverdue = now >= nextDueAt;
  // Booked before it comes due counts. So does anything booked at all once
  // you are already overdue — the couple has addressed it, and nagging past
  // that point is what makes this kind of app get deleted.
  const satisfiedByScheduled =
    nextScheduledAt !== null && (nextScheduledAt <= nextDueAt || isOverdue);

  const daysUntilDue = calendarDaysBetween(now, nextDueAt, timeZone);
  const intervalDays = Math.max(1, calendarDaysBetween(anchorAt, nextDueAt, timeZone));
  const dueSoonThresholdDays = Math.max(1, Math.round(intervalDays * DUE_SOON_RATIO));

  let health: CadenceHealth;
  if (satisfiedByScheduled) {
    health = 'on_track';
  } else if (isOverdue) {
    health = 'overdue';
  } else if (daysUntilDue <= dueSoonThresholdDays) {
    health = 'due_soon';
  } else {
    health = 'on_track';
  }

  const totalMs = nextDueAt.getTime() - anchorAt.getTime();
  const elapsedMs = now.getTime() - anchorAt.getTime();
  const progress = totalMs <= 0 ? 1 : clamp(elapsedMs / totalMs, 0, 1);

  return {
    domain: cadence.domain,
    kind: cadence.kind,
    lastCompletedAt,
    lastCompletedBy,
    anchorAt,
    nextDueAt,
    daysUntilDue,
    health,
    progress,
    nextScheduledAt,
    satisfiedByScheduled,
  };
}

/**
 * Upcoming occurrence dates for a standing ritual.
 *
 * Occurrences are derived on read and only become `plans` rows once confirmed
 * or skipped — there is no cron job and nothing to backfill when a couple
 * changes their interval.
 */
export function nextOccurrences(
  cadence: Cadence,
  anchorAt: Date,
  count: number,
  timeZone: string,
): Date[] {
  const out: Date[] = [];
  let cursor = anchorAt;
  for (let i = 0; i < count; i += 1) {
    cursor = addInterval(cursor, cadence.intervalValue, cadence.intervalUnit, timeZone);
    out.push(cursor);
  }
  return out;
}

/**
 * Sort key for showing several rituals together: most urgent first. Pure and
 * total, so it is safe to hand straight to `Array#sort`.
 */
export function compareUrgency(a: CadenceStatus, b: CadenceStatus): number {
  return a.daysUntilDue - b.daysUntilDue;
}

/** Translation key for a health state, so no display string is built here. */
/**
 * Whose turn it is to do the booking.
 *
 * `either` is a real answer, not a fallback: with no completed plan behind it
 * there is nothing to alternate from, and inventing a first turn would be this
 * app telling a couple who goes first.
 */
export type PlannerTurn = 'you' | 'them' | 'either';

/**
 * Alternate who books, derived rather than stored.
 *
 * Whoever booked the last completed one, it is the other person's turn. That
 * needs no column, no migration and no encryption work: `created_by` is
 * readable by design, because RLS and the authorship triggers need it, so the
 * whole rule is arithmetic over rows the screen already holds.
 *
 * Deriving it also means it cannot drift. A stored "whose turn" would need
 * somebody to write it on completion, and any missed write would leave the two
 * phones disagreeing about a fact that is supposed to be shared.
 *
 * It is a suggestion and nothing else. Either partner can book anything at any
 * time; nothing here counts, compares, or remembers a turn that was skipped —
 * a rotation that keeps score is the scoreboard invariant 4 exists to prevent.
 */
export function plannerTurn(status: CadenceStatus, profileId: string): PlannerTurn {
  if (!status.lastCompletedBy) return 'either';
  return status.lastCompletedBy === profileId ? 'them' : 'you';
}

export function healthLabelKey(health: CadenceHealth): string {
  return `cadence:health.${health}`;
}
