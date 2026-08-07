import type { Cadence, Plan } from '@couple/core';
import { describe, expect, it } from 'vitest';
import {
  addInterval,
  compareUrgency,
  computeCadenceStatus,
  nextOccurrences,
  nextWeekdayInZone,
} from './engine';

const NY = 'America/New_York';

function makeCadence(overrides: Partial<Cadence> = {}): Cadence {
  return {
    id: 'cadence-1',
    coupleId: 'couple-1',
    domain: 'intimacy',
    kind: 'intimacy',
    intervalValue: 1,
    intervalUnit: 'week',
    enabled: true,
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    coupleId: 'couple-1',
    domain: 'intimacy',
    kind: 'intimacy',
    title: null,
    notes: null,
    location: null,
    startsAt: null,
    endsAt: null,
    status: 'completed',
    createdBy: 'profile-1',
    completedAt: null,
    calendarEventIds: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
    unreadable: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function statusOf(args: {
  cadence?: Partial<Cadence>;
  plans?: Plan[];
  now: string;
  coupleCreatedAt?: string;
  timeZone?: string;
}) {
  return computeCadenceStatus({
    cadence: makeCadence(args.cadence),
    plans: args.plans ?? [],
    now: new Date(args.now),
    coupleCreatedAt: new Date(args.coupleCreatedAt ?? '2026-01-01T00:00:00.000Z'),
    timeZone: args.timeZone ?? 'UTC',
  });
}

describe('addInterval', () => {
  it('keeps wall-clock time across a spring-forward transition', () => {
    // 2026-03-01 20:00 EST (UTC-5); DST begins 2026-03-08.
    const anchor = new Date('2026-03-02T01:00:00.000Z');
    const result = addInterval(anchor, 1, 'week', NY);

    // 2026-03-08 20:00 EDT (UTC-4) — same wall clock, 167 real hours later.
    expect(result.toISOString()).toBe('2026-03-09T00:00:00.000Z');
    expect((result.getTime() - anchor.getTime()) / 3_600_000).toBe(167);
  });

  it('keeps wall-clock time across a fall-back transition', () => {
    // 2026-10-25 20:00 EDT (UTC-4); DST ends 2026-11-01.
    const anchor = new Date('2026-10-26T00:00:00.000Z');
    const result = addInterval(anchor, 1, 'week', NY);

    // 2026-11-01 20:00 EST (UTC-5) — same wall clock, 169 real hours later.
    expect(result.toISOString()).toBe('2026-11-02T01:00:00.000Z');
    expect((result.getTime() - anchor.getTime()) / 3_600_000).toBe(169);
  });

  it('clamps Feb 29 to Feb 28 when adding a year', () => {
    const result = addInterval(new Date('2024-02-29T12:00:00.000Z'), 1, 'year', 'UTC');
    expect(result.toISOString()).toBe('2025-02-28T12:00:00.000Z');
  });

  it('clamps end-of-month when adding months', () => {
    const result = addInterval(new Date('2026-01-31T12:00:00.000Z'), 1, 'month', 'UTC');
    expect(result.toISOString()).toBe('2026-02-28T12:00:00.000Z');
  });

  it.each([
    ['day', 2, '2026-01-03T00:00:00.000Z'],
    ['week', 2, '2026-01-15T00:00:00.000Z'],
    ['month', 2, '2026-03-01T00:00:00.000Z'],
    ['year', 2, '2028-01-01T00:00:00.000Z'],
  ] as const)('advances by %s', (unit, value, expected) => {
    const result = addInterval(new Date('2026-01-01T00:00:00.000Z'), value, unit, 'UTC');
    expect(result.toISOString()).toBe(expected);
  });
});

describe('computeCadenceStatus — anchoring', () => {
  it('falls back to the couple start date with no history', () => {
    const status = statusOf({ now: '2026-01-03T00:00:00.000Z' });

    expect(status.lastCompletedAt).toBeNull();
    expect(status.anchorAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(status.nextDueAt.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(status.health).toBe('on_track');
  });

  it('anchors on the most recent completed plan', () => {
    const status = statusOf({
      plans: [
        makePlan({ id: 'a', startsAt: '2026-01-05T00:00:00.000Z' }),
        makePlan({ id: 'b', startsAt: '2026-01-12T00:00:00.000Z' }),
        makePlan({ id: 'c', startsAt: '2026-01-09T00:00:00.000Z' }),
      ],
      now: '2026-01-13T00:00:00.000Z',
    });

    expect(status.lastCompletedAt?.toISOString()).toBe('2026-01-12T00:00:00.000Z');
    expect(status.nextDueAt.toISOString()).toBe('2026-01-19T00:00:00.000Z');
  });

  it('prefers when the plan happened over when it was ticked off', () => {
    const status = statusOf({
      plans: [
        makePlan({
          startsAt: '2026-01-05T00:00:00.000Z',
          completedAt: '2026-01-20T00:00:00.000Z',
        }),
      ],
      now: '2026-01-21T00:00:00.000Z',
    });

    expect(status.anchorAt.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('falls back to completedAt when a plan has no start time', () => {
    const status = statusOf({
      plans: [makePlan({ startsAt: null, completedAt: '2026-01-05T00:00:00.000Z' })],
      now: '2026-01-06T00:00:00.000Z',
    });

    expect(status.anchorAt.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('ignores non-completed plans when anchoring', () => {
    const status = statusOf({
      plans: [
        makePlan({ id: 'skipped', status: 'skipped', startsAt: '2026-01-20T00:00:00.000Z' }),
        makePlan({ id: 'declined', status: 'declined', startsAt: '2026-01-21T00:00:00.000Z' }),
        makePlan({ id: 'idea', status: 'idea', startsAt: '2026-01-22T00:00:00.000Z' }),
      ],
      now: '2026-01-23T00:00:00.000Z',
    });

    expect(status.lastCompletedAt).toBeNull();
    expect(status.anchorAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('never mixes kinds or domains', () => {
    const status = statusOf({
      cadence: { domain: 'two_two_two', kind: 'date_night', intervalValue: 2 },
      plans: [
        makePlan({ id: 'other-kind', kind: 'extended', startsAt: '2026-02-01T00:00:00.000Z' }),
        makePlan({
          id: 'other-domain',
          domain: 'two_two_two',
          kind: 'getaway',
          startsAt: '2026-02-02T00:00:00.000Z',
        }),
        makePlan({
          id: 'intimacy-leak',
          domain: 'intimacy',
          kind: 'date_night',
          startsAt: '2026-02-03T00:00:00.000Z',
        }),
      ],
      now: '2026-02-04T00:00:00.000Z',
    });

    expect(status.lastCompletedAt).toBeNull();
  });
});

describe('computeCadenceStatus — health', () => {
  it('reports overdue with a negative day count', () => {
    const status = statusOf({ now: '2026-01-15T00:00:00.000Z' });

    expect(status.health).toBe('overdue');
    expect(status.daysUntilDue).toBe(-7);
    expect(status.progress).toBe(1);
  });

  it('warns a day out for a weekly ritual', () => {
    // 7-day interval -> threshold of 1 day.
    expect(statusOf({ now: '2026-01-06T00:00:00.000Z' }).health).toBe('on_track');
    expect(statusOf({ now: '2026-01-07T00:00:00.000Z' }).health).toBe('due_soon');
  });

  it('warns months out for a two-year ritual', () => {
    const twoYears = {
      cadence: { domain: 'two_two_two', kind: 'trip', intervalValue: 2, intervalUnit: 'year' },
    } as const;

    // Interval is 730 days -> threshold of ~110 days.
    expect(statusOf({ ...twoYears, now: '2027-08-01T00:00:00.000Z' }).health).toBe('on_track');
    expect(statusOf({ ...twoYears, now: '2027-11-01T00:00:00.000Z' }).health).toBe('due_soon');
  });

  it('reports progress through the interval', () => {
    const status = statusOf({ now: '2026-01-04T12:00:00.000Z' });
    expect(status.progress).toBeCloseTo(0.5, 5);
  });

  it('clamps progress to zero before the anchor', () => {
    const status = statusOf({
      now: '2025-12-25T00:00:00.000Z',
      coupleCreatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(status.progress).toBe(0);
  });
});

describe('computeCadenceStatus — scheduled plans', () => {
  it('treats a plan booked before the due date as on track', () => {
    const status = statusOf({
      plans: [
        makePlan({ id: 'booked', status: 'scheduled', startsAt: '2026-01-07T00:00:00.000Z' }),
      ],
      now: '2026-01-07T00:00:00.000Z',
    });

    expect(status.satisfiedByScheduled).toBe(true);
    expect(status.health).toBe('on_track');
    expect(status.nextScheduledAt?.toISOString()).toBe('2026-01-07T00:00:00.000Z');
  });

  it('does not let a distant booking silence a due warning', () => {
    const status = statusOf({
      plans: [makePlan({ id: 'far', status: 'scheduled', startsAt: '2026-03-01T00:00:00.000Z' })],
      now: '2026-01-07T00:00:00.000Z',
    });

    expect(status.satisfiedByScheduled).toBe(false);
    expect(status.health).toBe('due_soon');
  });

  it('stops nagging once something is booked, even when already overdue', () => {
    const status = statusOf({
      plans: [
        makePlan({ id: 'rescue', status: 'scheduled', startsAt: '2026-02-01T00:00:00.000Z' }),
      ],
      now: '2026-01-20T00:00:00.000Z',
    });

    expect(status.satisfiedByScheduled).toBe(true);
    expect(status.health).toBe('on_track');
  });

  it('does not advance the anchor until the plan is completed', () => {
    const status = statusOf({
      plans: [
        makePlan({ id: 'booked', status: 'scheduled', startsAt: '2026-01-07T00:00:00.000Z' }),
      ],
      now: '2026-01-06T00:00:00.000Z',
    });

    expect(status.anchorAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(status.nextDueAt.toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });

  it('ignores bookings that have already passed', () => {
    const status = statusOf({
      plans: [makePlan({ id: 'past', status: 'scheduled', startsAt: '2026-01-02T00:00:00.000Z' })],
      now: '2026-01-05T00:00:00.000Z',
    });

    expect(status.nextScheduledAt).toBeNull();
    expect(status.satisfiedByScheduled).toBe(false);
  });

  it('picks the soonest of several bookings', () => {
    const status = statusOf({
      plans: [
        makePlan({ id: 'later', status: 'scheduled', startsAt: '2026-01-10T00:00:00.000Z' }),
        makePlan({ id: 'sooner', status: 'scheduled', startsAt: '2026-01-06T00:00:00.000Z' }),
      ],
      now: '2026-01-05T00:00:00.000Z',
    });

    expect(status.nextScheduledAt?.toISOString()).toBe('2026-01-06T00:00:00.000Z');
  });
});

describe('computeCadenceStatus — timezone', () => {
  it('counts days as the couple would read them off a wall calendar', () => {
    // 19:00 in New York on Jan 7 is already Jan 8 in UTC. The couple should
    // still be told the ritual is due "tomorrow", not "today".
    const status = statusOf({
      now: '2026-01-08T00:00:00.000Z',
      coupleCreatedAt: '2026-01-01T05:00:00.000Z',
      timeZone: NY,
    });

    expect(status.daysUntilDue).toBe(1);
  });
});

describe('nextOccurrences', () => {
  it('projects forward from the anchor', () => {
    const dates = nextOccurrences(
      makeCadence({ intervalValue: 2, intervalUnit: 'week' }),
      new Date('2026-01-01T00:00:00.000Z'),
      3,
      'UTC',
    );

    expect(dates.map((date) => date.toISOString())).toEqual([
      '2026-01-15T00:00:00.000Z',
      '2026-01-29T00:00:00.000Z',
      '2026-02-12T00:00:00.000Z',
    ]);
  });

  it('returns nothing when asked for nothing', () => {
    expect(nextOccurrences(makeCadence(), new Date(), 0, 'UTC')).toEqual([]);
  });
});

describe('compareUrgency', () => {
  it('sorts the most overdue first', () => {
    const overdue = statusOf({ now: '2026-01-20T00:00:00.000Z' });
    const dueSoon = statusOf({ now: '2026-01-07T00:00:00.000Z' });
    const onTrack = statusOf({ now: '2026-01-02T00:00:00.000Z' });

    const sorted = [onTrack, overdue, dueSoon].sort(compareUrgency);
    expect(sorted.map((status) => status.health)).toEqual(['overdue', 'due_soon', 'on_track']);
  });
});

describe('nextWeekdayInZone', () => {
  const saturday = 6;

  it('walks forward to the coming weekday', () => {
    // Wednesday 2026-01-07, 12:00 UTC.
    const from = new Date('2026-01-07T12:00:00.000Z');
    expect(nextWeekdayInZone(from, saturday, 'UTC').toISOString()).toBe('2026-01-10T12:00:00.000Z');
  });

  it('returns the instant itself when it is already that day', () => {
    // Saturday. "This weekend" on a Saturday means today, not in a week.
    const from = new Date('2026-01-10T12:00:00.000Z');
    expect(nextWeekdayInZone(from, saturday, 'UTC')).toBe(from);
  });

  it('is the longest wait the day after', () => {
    // Sunday — six days to the next Saturday, never zero.
    const from = new Date('2026-01-11T12:00:00.000Z');
    expect(nextWeekdayInZone(from, saturday, 'UTC').toISOString()).toBe('2026-01-17T12:00:00.000Z');
  });

  /**
   * The reason this takes a timezone at all. 23:00 Friday in Madrid is already
   * Saturday in Auckland, so the same instant answers differently depending on
   * whose calendar is asking — and the couple's is the only one that counts.
   */
  it("reads the weekday on the couple's calendar, not the instant's", () => {
    const fridayNightInMadrid = new Date('2026-01-09T22:00:00.000Z');

    // Madrid: still Friday, so the coming Saturday is tomorrow.
    expect(nextWeekdayInZone(fridayNightInMadrid, saturday, 'Europe/Madrid').toISOString()).toBe(
      '2026-01-10T22:00:00.000Z',
    );
    // Auckland: already Saturday, so it is today.
    expect(nextWeekdayInZone(fridayNightInMadrid, saturday, 'Pacific/Auckland')).toBe(
      fridayNightInMadrid,
    );
  });
});
