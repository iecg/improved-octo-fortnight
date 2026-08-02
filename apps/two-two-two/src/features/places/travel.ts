/**
 * How far away a place is, and whether that is too far.
 *
 * Pure, and outside `maps/`: it takes durations as data and never asks where
 * they came from, so it is equally correct when nothing is configured and every
 * duration is unknown.
 *
 * Not in `packages/cadence`, despite being pure enough to live there. That
 * package does interval arithmetic over a couple's timezone and its whole value
 * is having one reason to exist; a drive-time filter has nothing to do with
 * recurrence, and putting it there would invite the next person to add the
 * fetch beside it.
 *
 * Like the cadence engine, this returns translation *keys* and counts rather
 * than formatted strings. Pluralization then happens in `t()` in each partner's
 * own language, and `tests/i18n/parity.test.ts` is what checks both languages
 * have the forms.
 */

/** How far each commitment is plausibly worth travelling, in minutes. */
export const DRIVE_BUDGETS: Record<string, number | null> = {
  // An evening out. A drive budget would be answering a question nobody asked.
  date_night: null,
  // Two nights away is worth a couple of hours in the car; much more and the
  // driving is the weekend.
  getaway: 120,
  // Two years of anticipation is not filtered by drive time.
  trip: null,
};

export function driveBudgetFor(kind: string): number | null {
  return DRIVE_BUDGETS[kind] ?? null;
}

/**
 * Keep the candidates within the budget — and the ones we know nothing about.
 *
 * An unknown journey is not a long one. The provider not routing somewhere
 * means the road is missing from a map, not that the place is too far, and
 * silently dropping it would make a couple wonder where the venue they can see
 * on the same screen went. A person decides; this only removes what is
 * definitely too far.
 */
export function withinDriveBudget<T>(
  candidates: T[],
  minutes: (number | null)[],
  budgetMinutes: number | null,
): T[] {
  if (budgetMinutes === null) return [...candidates];
  return candidates.filter((_candidate, index) => {
    const duration = minutes[index];
    if (duration === null || duration === undefined) return true;
    return duration <= budgetMinutes;
  });
}

export interface DriveTimeLabel {
  key: string;
  count: number;
}

/**
 * A translation key and a count, never a sentence.
 *
 * Rounds to the half hour past 90 minutes, because "a two hour drive" is how
 * anyone actually describes it and "1h 52m" implies a precision that a
 * traffic-unaware estimate for a date three weeks out does not have.
 */
export function driveTimeLabel(minutes: number | null): DriveTimeLabel {
  if (minutes === null || !Number.isFinite(minutes)) {
    return { key: 'places:travel.unknown', count: 0 };
  }
  if (minutes < 90) {
    // Five-minute steps, and never zero: a place two minutes away is still a
    // journey, and "0 minutes" reads as an error rather than as "next door".
    return { key: 'places:travel.minutes', count: Math.max(5, Math.round(minutes / 5) * 5) };
  }
  // Halves, so 150 minutes reads as two and a half hours rather than three.
  const halves = Math.round(minutes / 30);
  return { key: 'places:travel.hours', count: halves / 2 };
}
