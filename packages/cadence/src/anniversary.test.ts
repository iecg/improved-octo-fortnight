import { describe, expect, it } from 'vitest';

import { nextAnniversaryDays } from './engine';

const UTC = 'UTC';

describe('nextAnniversaryDays', () => {
  it('counts forward to this year’s date', () => {
    const now = new Date('2026-06-10T00:00:00Z');
    expect(nextAnniversaryDays('2010-06-15', now, UTC)).toBe(5);
  });

  it('is zero on the day itself', () => {
    const now = new Date('2026-06-15T09:00:00Z');
    expect(nextAnniversaryDays('2010-06-15', now, UTC)).toBe(0);
  });

  it('rolls to next year once the date has passed', () => {
    const now = new Date('2026-06-16T00:00:00Z');
    // 2026-06-16 → 2027-06-15.
    expect(nextAnniversaryDays('2010-06-15', now, UTC)).toBe(364);
  });

  it('follows Date rollover for a Feb-29 anniversary in a common year', () => {
    const now = new Date('2025-02-01T00:00:00Z');
    // Feb 2025 has 28 days, so the occurrence lands on Mar 1 → 28 days out.
    expect(nextAnniversaryDays('2000-02-29', now, UTC)).toBe(28);
  });

  it('counts on the couple’s wall calendar, not UTC', () => {
    // 21:00 in New York on the 14th is still the 14th there, though it is the
    // 15th in UTC — the anniversary on the 15th is one day away, not today.
    const now = new Date('2026-02-15T02:00:00Z');
    expect(nextAnniversaryDays('2020-02-15', now, 'America/New_York')).toBe(1);
  });
});
