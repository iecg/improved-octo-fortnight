import { describe, expect, it } from 'vitest';

import type { Plan, PlanStatus } from '@couple/core';

import {
  atHourInZone,
  busyFromPlans,
  groupPlans,
  mergeRanges,
  overlapsAny,
  suggestWindows,
  type TimeRange,
} from './windows';

const UTC = 'UTC';

function range(start: string, end: string): TimeRange {
  return { start: new Date(start), end: new Date(end) };
}

function iso(ranges: TimeRange[]): string[] {
  return ranges.map((r) => `${r.start.toISOString()}/${r.end.toISOString()}`);
}

describe('atHourInZone', () => {
  it('lands on the wall-clock hour in the couple’s zone, not the host’s', () => {
    // The host zone is pinned to Pacific/Auckland by the vitest config, so a
    // naive implementation would be off by most of a day here.
    const at = atHourInZone(new Date('2026-09-12T15:00:00Z'), 19, 'America/New_York');
    expect(at.toISOString()).toBe('2026-09-12T23:00:00.000Z'); // 19:00 EDT
  });

  it('gives the same local hour on both sides of a DST change', () => {
    // 2026-03-08 is the US spring-forward. Both are 09:00 locally; the UTC
    // offset differs by an hour precisely because the local hour does not.
    const before = atHourInZone(new Date('2026-03-07T12:00:00Z'), 9, 'America/New_York');
    const after = atHourInZone(new Date('2026-03-09T12:00:00Z'), 9, 'America/New_York');

    expect(before.toISOString()).toBe('2026-03-07T14:00:00.000Z'); // EST, UTC-5
    expect(after.toISOString()).toBe('2026-03-09T13:00:00.000Z'); // EDT, UTC-4
  });

  it('ignores the time of day already on the anchor', () => {
    const morning = atHourInZone(new Date('2026-09-12T04:00:00Z'), 20, 'UTC');
    const evening = atHourInZone(new Date('2026-09-12T22:00:00Z'), 20, 'UTC');
    expect(morning.toISOString()).toBe(evening.toISOString());
  });
});

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    coupleId: 'couple-1',
    domain: 'intimacy',
    kind: 'intimacy',
    title: null,
    notes: null,
    location: null,
    startsAt: '2026-09-12T18:00:00.000Z',
    endsAt: '2026-09-12T20:00:00.000Z',
    status: 'scheduled',
    createdBy: 'them',
    completedAt: null,
    calendarEventIds: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    unreadable: false,
    ...overrides,
  };
}

describe('busyFromPlans', () => {
  it.each<PlanStatus>(['proposed', 'scheduled'])('counts a %s plan as occupied', (status) => {
    expect(busyFromPlans([makePlan({ status })])).toEqual([
      { start: new Date('2026-09-12T18:00:00.000Z'), end: new Date('2026-09-12T20:00:00.000Z') },
    ]);
  });

  /**
   * `proposed` is the reason this exists and the reason it is not `BOOKED`:
   * a time under negotiation blocks the calendar without earning an entry on
   * it, so the two sets must not be collapsed into one.
   */
  it.each<PlanStatus>(['idea', 'completed', 'skipped', 'declined'])(
    'ignores a %s plan',
    (status) => {
      expect(busyFromPlans([makePlan({ status })])).toEqual([]);
    },
  );

  it.each([
    ['no start', { startsAt: null }],
    ['no end', { endsAt: null }],
    ['neither', { startsAt: null, endsAt: null }],
  ])('ignores a plan with %s — it is not yet a time', (_label, overrides) => {
    expect(busyFromPlans([makePlan(overrides)])).toEqual([]);
  });

  it('ignores an unparseable or inverted span rather than emitting a bad block', () => {
    expect(busyFromPlans([makePlan({ startsAt: 'not a date' })])).toEqual([]);
    expect(
      busyFromPlans([
        makePlan({ startsAt: '2026-09-12T20:00:00.000Z', endsAt: '2026-09-12T18:00:00.000Z' }),
      ]),
    ).toEqual([]);
  });

  it('feeds straight into overlapsAny, which is the whole point', () => {
    const busy = busyFromPlans([makePlan({ status: 'proposed' })]);
    expect(overlapsAny(range('2026-09-12T19:00:00Z', '2026-09-12T21:00:00Z'), busy)).toBe(true);
    expect(overlapsAny(range('2026-09-12T20:00:00Z', '2026-09-12T22:00:00Z'), busy)).toBe(false);
  });

  it('returns nothing for an empty list', () => {
    expect(busyFromPlans([])).toEqual([]);
  });
});

describe('overlapsAny', () => {
  const busy = [
    range('2026-09-12T18:00:00Z', '2026-09-12T20:00:00Z'),
    range('2026-09-14T09:00:00Z', '2026-09-14T17:00:00Z'),
  ];

  it.each([
    ['starting inside a block', '2026-09-12T19:00:00Z', '2026-09-12T21:00:00Z'],
    ['ending inside a block', '2026-09-12T17:00:00Z', '2026-09-12T19:00:00Z'],
    ['swallowing a block whole', '2026-09-12T12:00:00Z', '2026-09-13T12:00:00Z'],
    ['sitting entirely inside one', '2026-09-12T18:30:00Z', '2026-09-12T19:00:00Z'],
    ['spanning days into the second block', '2026-09-13T20:00:00Z', '2026-09-14T10:00:00Z'],
  ])('detects a candidate %s', (_label, start, end) => {
    expect(overlapsAny(range(start, end), busy)).toBe(true);
  });

  it.each([
    ['before everything', '2026-09-12T15:00:00Z', '2026-09-12T17:00:00Z'],
    ['between two blocks', '2026-09-13T09:00:00Z', '2026-09-13T11:00:00Z'],
    ['after everything', '2026-09-15T09:00:00Z', '2026-09-15T11:00:00Z'],
  ])('clears a candidate %s', (_label, start, end) => {
    expect(overlapsAny(range(start, end), busy)).toBe(false);
  });

  it('treats touching as free, the same way mergeRanges does', () => {
    // A plan starting the moment a block ends is back-to-back, not a clash.
    expect(overlapsAny(range('2026-09-12T20:00:00Z', '2026-09-12T22:00:00Z'), busy)).toBe(false);
    expect(overlapsAny(range('2026-09-12T16:00:00Z', '2026-09-12T18:00:00Z'), busy)).toBe(false);
  });

  it('is false against an empty calendar', () => {
    expect(overlapsAny(range('2026-09-12T19:00:00Z', '2026-09-12T21:00:00Z'), [])).toBe(false);
  });

  it('is false for an empty or inverted candidate', () => {
    expect(overlapsAny(range('2026-09-12T19:00:00Z', '2026-09-12T19:00:00Z'), busy)).toBe(false);
    expect(overlapsAny(range('2026-09-12T20:00:00Z', '2026-09-12T18:00:00Z'), busy)).toBe(false);
  });
});

describe('mergeRanges', () => {
  it('coalesces overlapping blocks', () => {
    const merged = mergeRanges([
      range('2026-03-02T10:00:00Z', '2026-03-02T12:00:00Z'),
      range('2026-03-02T11:00:00Z', '2026-03-02T13:00:00Z'),
    ]);

    expect(iso(merged)).toEqual(['2026-03-02T10:00:00.000Z/2026-03-02T13:00:00.000Z']);
  });

  it('coalesces blocks that merely touch', () => {
    const merged = mergeRanges([
      range('2026-03-02T10:00:00Z', '2026-03-02T11:00:00Z'),
      range('2026-03-02T11:00:00Z', '2026-03-02T12:00:00Z'),
    ]);

    expect(merged).toHaveLength(1);
  });

  it('keeps separate blocks apart and sorts them', () => {
    const merged = mergeRanges([
      range('2026-03-02T15:00:00Z', '2026-03-02T16:00:00Z'),
      range('2026-03-02T10:00:00Z', '2026-03-02T11:00:00Z'),
    ]);

    expect(iso(merged)).toEqual([
      '2026-03-02T10:00:00.000Z/2026-03-02T11:00:00.000Z',
      '2026-03-02T15:00:00.000Z/2026-03-02T16:00:00.000Z',
    ]);
  });

  it('drops zero-length blocks', () => {
    expect(mergeRanges([range('2026-03-02T10:00:00Z', '2026-03-02T10:00:00Z')])).toEqual([]);
  });
});

describe('suggestWindows', () => {
  const base = {
    from: new Date('2026-03-02T00:00:00Z'),
    to: new Date('2026-03-04T00:00:00Z'),
    durationMinutes: 90,
    earliestHour: 20,
    latestHour: 23,
    timeZone: UTC,
    limit: 5,
  };

  it('offers the start of the evening band when nothing is booked', () => {
    const windows = suggestWindows([], { ...base, limit: 2 });

    expect(iso(windows)).toEqual([
      '2026-03-02T20:00:00.000Z/2026-03-02T21:30:00.000Z',
      '2026-03-03T20:00:00.000Z/2026-03-03T21:30:00.000Z',
    ]);
  });

  it('works around a busy block', () => {
    const windows = suggestWindows([range('2026-03-02T20:00:00Z', '2026-03-02T21:00:00Z')], {
      ...base,
      limit: 1,
    });

    expect(iso(windows)).toEqual(['2026-03-02T21:00:00.000Z/2026-03-02T22:30:00.000Z']);
  });

  it('skips a day with no gap long enough', () => {
    const windows = suggestWindows([range('2026-03-02T19:00:00Z', '2026-03-02T23:00:00Z')], {
      ...base,
      limit: 1,
    });

    expect(iso(windows)).toEqual(['2026-03-03T20:00:00.000Z/2026-03-03T21:30:00.000Z']);
  });

  it('never suggests outside the allowed hours', () => {
    const windows = suggestWindows([], { ...base, limit: 10 });

    for (const window of windows) {
      expect(window.start.getUTCHours()).toBeGreaterThanOrEqual(20);
      expect(window.end.getUTCHours()).toBeLessThanOrEqual(23);
    }
  });

  it('respects the limit', () => {
    expect(suggestWindows([], { ...base, limit: 1 })).toHaveLength(1);
  });

  it('never starts a suggestion before the search range opens', () => {
    const windows = suggestWindows([], {
      ...base,
      from: new Date('2026-03-02T21:00:00Z'),
      limit: 1,
    });

    expect(iso(windows)).toEqual(['2026-03-02T21:00:00.000Z/2026-03-02T22:30:00.000Z']);
  });

  it("honours the couple's timezone rather than UTC", () => {
    const windows = suggestWindows([], {
      ...base,
      timeZone: 'America/New_York',
      limit: 1,
    });

    // Midnight UTC on 2026-03-02 is still the evening of 2026-03-01 in New
    // York, so that evening is the first one available — 20:00 EST is 01:00Z.
    expect(iso(windows)).toEqual(['2026-03-02T01:00:00.000Z/2026-03-02T02:30:00.000Z']);
  });

  it('keeps the evening band steady across a DST transition', () => {
    // DST begins 2026-03-08 in New York. The band must stay 20:00 local on
    // both sides, not drift by an hour.
    const windows = suggestWindows([], {
      from: new Date('2026-03-07T00:00:00Z'),
      to: new Date('2026-03-11T00:00:00Z'),
      durationMinutes: 60,
      earliestHour: 20,
      latestHour: 23,
      timeZone: 'America/New_York',
      limit: 4,
    });

    // Every entry is 20:00 local. The UTC offset moves by an hour across the
    // transition precisely because the local hour did not.
    expect(iso(windows)).toEqual([
      '2026-03-07T01:00:00.000Z/2026-03-07T02:00:00.000Z', // Mar 6, 20:00 EST
      '2026-03-08T01:00:00.000Z/2026-03-08T02:00:00.000Z', // Mar 7, 20:00 EST
      '2026-03-09T00:00:00.000Z/2026-03-09T01:00:00.000Z', // Mar 8, 20:00 EDT
      '2026-03-10T00:00:00.000Z/2026-03-10T01:00:00.000Z', // Mar 9, 20:00 EDT
    ]);
  });

  it.each([
    ['zero duration', { durationMinutes: 0 }],
    ['zero limit', { limit: 0 }],
    ['inverted range', { to: new Date('2026-03-01T00:00:00Z') }],
    ['inverted hours', { earliestHour: 23, latestHour: 20 }],
  ])('returns nothing for %s', (_label, override) => {
    expect(suggestWindows([], { ...base, ...override })).toEqual([]);
  });
});

describe('groupPlans', () => {
  const now = new Date('2026-09-12T21:00:00.000Z');

  /**
   * The regression this function was written for.
   *
   * Both apps filtered upcoming on `startsAt >= now` and history on
   * `completed || skipped`, so a plan still `scheduled` after its end time
   * matched neither and vanished — with no way to mark it done, and therefore
   * no way for its cadence to re-anchor.
   */
  it('keeps a booked plan whose time has passed', () => {
    const over = makePlan({
      id: 'over',
      startsAt: '2026-09-12T18:00:00.000Z',
      endsAt: '2026-09-12T20:00:00.000Z',
    });

    const { needsAnswer, upcoming, history } = groupPlans([over], now);

    expect(needsAnswer.map((p) => p.id)).toEqual(['over']);
    expect(upcoming).toEqual([]);
    expect(history).toEqual([]);
  });

  it('leaves a plan that is happening right now alone', () => {
    // Started an hour ago, ends in an hour. Asking "did this happen?" while
    // the couple is out is the wrong question.
    const during = makePlan({
      id: 'during',
      startsAt: '2026-09-12T20:00:00.000Z',
      endsAt: '2026-09-12T22:00:00.000Z',
    });

    const { needsAnswer, upcoming } = groupPlans([during], now);

    expect(needsAnswer).toEqual([]);
    expect(upcoming.map((p) => p.id)).toEqual(['during']);
  });

  it('measures from the end, not the start', () => {
    // No `endsAt`, so the start is the whole of it — and it is behind us.
    const open = makePlan({ id: 'open', startsAt: '2026-09-12T18:00:00.000Z', endsAt: null });

    expect(groupPlans([open], now).needsAnswer.map((p) => p.id)).toEqual(['open']);
  });

  it('sorts each group the way its screen reads it', () => {
    const plans = [
      makePlan({ id: 'soon', startsAt: '2026-09-13T18:00:00.000Z', endsAt: null }),
      makePlan({ id: 'later', startsAt: '2026-09-20T18:00:00.000Z', endsAt: null }),
      makePlan({ id: 'old-miss', startsAt: '2026-09-01T18:00:00.000Z', endsAt: null }),
      makePlan({ id: 'recent-miss', startsAt: '2026-09-10T18:00:00.000Z', endsAt: null }),
      makePlan({ id: 'old-done', status: 'completed', startsAt: '2026-08-01T18:00:00.000Z' }),
      makePlan({ id: 'recent-done', status: 'skipped', startsAt: '2026-09-05T18:00:00.000Z' }),
    ];

    const grouped = groupPlans(plans, now);

    expect(grouped.upcoming.map((p) => p.id)).toEqual(['soon', 'later']);
    expect(grouped.needsAnswer.map((p) => p.id)).toEqual(['recent-miss', 'old-miss']);
    expect(grouped.history.map((p) => p.id)).toEqual(['recent-done', 'old-done']);
  });

  it('shows nothing for a status that was never a commitment', () => {
    const ignored = ['idea', 'proposed', 'declined'] as const;

    for (const status of ignored) {
      const grouped = groupPlans([makePlan({ status })], now);
      expect([grouped.needsAnswer, grouped.upcoming, grouped.history]).toEqual([[], [], []]);
    }
  });

  it('waits with the rest when a booked plan has no time on it', () => {
    const undated = makePlan({ id: 'undated', startsAt: null, endsAt: null });

    expect(groupPlans([undated], now).upcoming.map((p) => p.id)).toEqual(['undated']);
  });
});
