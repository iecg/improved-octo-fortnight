import { describe, expect, it } from 'vitest';

// Relative rather than the `@/` alias: this runs under the workspace-root
// vitest config, which resolves from the repo root and knows nothing about the
// app's TypeScript paths.
import { describeCadence, isChoreDue, nextDueDates, resolveRotatingAssignee } from './cadence';

describe('isChoreDue', () => {
  it('daily is due every day from start_date onward, never before', () => {
    expect(isChoreDue('daily', {}, '2026-08-01', '2026-08-01')).toBe(true);
    expect(isChoreDue('daily', {}, '2026-08-01', '2026-09-15')).toBe(true);
    expect(isChoreDue('daily', {}, '2026-08-01', '2026-07-31')).toBe(false);
  });

  it('weekly_days matches only the configured weekdays', () => {
    // 2026-08-10 is a Monday (dow=1), 2026-08-11 is Tuesday (dow=2)
    const config = { weekdays: [1, 3, 5] }; // Mon/Wed/Fri
    expect(isChoreDue('weekly_days', config, '2026-08-01', '2026-08-10')).toBe(true);
    expect(isChoreDue('weekly_days', config, '2026-08-01', '2026-08-11')).toBe(false);
  });

  it('every_n_days is due on the start date and every n days after', () => {
    const config = { n: 3 };
    expect(isChoreDue('every_n_days', config, '2026-08-01', '2026-08-01')).toBe(true);
    expect(isChoreDue('every_n_days', config, '2026-08-01', '2026-08-04')).toBe(true);
    expect(isChoreDue('every_n_days', config, '2026-08-01', '2026-08-05')).toBe(false);
    expect(isChoreDue('every_n_days', config, '2026-08-01', '2026-08-07')).toBe(true);
  });

  it('monthly clamps day_of_month to the last day of shorter months', () => {
    const config = { day_of_month: 31 };
    // February 2026 has 28 days
    expect(isChoreDue('monthly', config, '2026-01-01', '2026-02-28')).toBe(true);
    expect(isChoreDue('monthly', config, '2026-01-01', '2026-01-31')).toBe(true);
    expect(isChoreDue('monthly', config, '2026-01-01', '2026-03-31')).toBe(true);
    expect(isChoreDue('monthly', config, '2026-01-01', '2026-03-30')).toBe(false);
  });
});

describe('nextDueDates', () => {
  it('returns the requested count of upcoming due dates for every_n_days', () => {
    const dates = nextDueDates('every_n_days', { n: 2 }, '2026-08-01', '2026-08-01', 3);
    expect(dates).toEqual(['2026-08-01', '2026-08-03', '2026-08-05']);
  });

  it('does not hang on a degenerate weekly_days config with no weekdays selected', () => {
    const dates = nextDueDates('weekly_days', { weekdays: [] }, '2026-08-01', '2026-08-01', 3);
    expect(dates).toEqual([]);
  });
});

describe('resolveRotatingAssignee', () => {
  it('cycles through members in order as next_position advances', () => {
    const members = ['a', 'b', 'c'];
    expect(resolveRotatingAssignee(members, 0)).toBe('a');
    expect(resolveRotatingAssignee(members, 1)).toBe('b');
    expect(resolveRotatingAssignee(members, 3)).toBe('a');
  });

  it('returns null when there are no members', () => {
    expect(resolveRotatingAssignee([], 0)).toBeNull();
  });
});

describe('describeCadence', () => {
  it('produces a human-readable summary for each cadence type', () => {
    expect(describeCadence('daily', {})).toBe('Every day');
    expect(describeCadence('weekly_days', { weekdays: [1, 3, 5] })).toBe('Mon, Wed, Fri');
    expect(describeCadence('every_n_days', { n: 3 })).toBe('Every 3 days');
    expect(describeCadence('monthly', { day_of_month: 15 })).toBe('Monthly on day 15');
  });
});
