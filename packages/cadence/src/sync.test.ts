import type { Plan, PlanStatus } from '@couple/core';
import { describe, expect, it } from 'vitest';

import { calendarActions, plannedReminders } from './sync';

const ME = 'profile-me';
const THEM = 'profile-them';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    coupleId: 'couple-1',
    domain: 'intimacy',
    kind: 'intimacy',
    title: null,
    notes: null,
    location: null,
    startsAt: '2026-03-10T20:00:00.000Z',
    endsAt: '2026-03-10T21:30:00.000Z',
    status: 'scheduled',
    createdBy: THEM,
    completedAt: null,
    calendarEventIds: {},
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('calendarActions', () => {
  it('writes an event for a booked plan this device has not seen', () => {
    const { toWrite, toRemove } = calendarActions([makePlan()], ME);

    expect(toWrite.map((p) => p.id)).toEqual(['plan-1']);
    expect(toRemove).toEqual([]);
  });

  it("writes even when the partner's phone already has its own event", () => {
    // The partner accepted; this device was not running. Their id being
    // present must not be mistaken for this device being done.
    const plan = makePlan({ calendarEventIds: { [THEM]: 'their-event' } });
    const { toWrite } = calendarActions([plan], ME);

    expect(toWrite.map((p) => p.id)).toEqual(['plan-1']);
  });

  it('does nothing when this device already has its event', () => {
    const plan = makePlan({ calendarEventIds: { [ME]: 'my-event' } });
    const { toWrite, toRemove } = calendarActions([plan], ME);

    expect(toWrite).toEqual([]);
    expect(toRemove).toEqual([]);
  });

  it('never writes a booked plan with no time on it', () => {
    const plan = makePlan({ startsAt: null });
    expect(calendarActions([plan], ME).toWrite).toEqual([]);
  });

  it.each<PlanStatus>(['idea', 'proposed'])('does not write a %s plan', (status) => {
    expect(calendarActions([makePlan({ status })], ME).toWrite).toEqual([]);
  });

  it.each<PlanStatus>(['declined', 'skipped', 'idea', 'proposed'])(
    'removes the entry once a plan becomes %s',
    (status) => {
      const plan = makePlan({ status, calendarEventIds: { [ME]: 'my-event' } });
      const { toRemove } = calendarActions([plan], ME);

      expect(toRemove).toEqual([[plan, 'my-event']]);
    },
  );

  it('keeps the entry for something that actually happened', () => {
    // Deleting a completed plan's event would rewrite the couple's history.
    const plan = makePlan({
      status: 'completed',
      completedAt: '2026-03-10T21:30:00.000Z',
      calendarEventIds: { [ME]: 'my-event' },
    });

    expect(calendarActions([plan], ME).toRemove).toEqual([]);
  });

  it("never touches the other partner's event id", () => {
    const plan = makePlan({
      status: 'declined',
      calendarEventIds: { [THEM]: 'their-event' },
    });

    // This device has nothing of its own to remove, and must not remove theirs.
    expect(calendarActions([plan], ME)).toEqual({ toWrite: [], toUpdate: [], toRemove: [] });
  });
});

describe('plannedReminders', () => {
  const now = new Date('2026-03-10T12:00:00.000Z');

  it('schedules ahead of the start by the lead time', () => {
    const reminders = plannedReminders([makePlan()], now, 120);

    expect(reminders).toEqual([
      { key: 'plan.plan-1', planId: 'plan-1', at: new Date('2026-03-10T18:00:00.000Z') },
    ]);
  });

  it('skips a reminder whose moment has already passed', () => {
    // A phone that was off for a week must not buzz on wake.
    expect(plannedReminders([makePlan()], now, 24 * 60)).toEqual([]);
  });

  it('skips plans that are not booked', () => {
    expect(plannedReminders([makePlan({ status: 'proposed' })], now, 60)).toEqual([]);
  });

  it('uses a key stable per plan, so rescheduling replaces', () => {
    const first = plannedReminders([makePlan()], now, 60);
    const second = plannedReminders([makePlan()], now, 30);

    expect(first[0]!.key).toBe(second[0]!.key);
    expect(first[0]!.at).not.toEqual(second[0]!.at);
  });

  it('returns the soonest first', () => {
    const reminders = plannedReminders(
      [
        makePlan({ id: 'later', startsAt: '2026-03-12T20:00:00.000Z' }),
        makePlan({ id: 'sooner', startsAt: '2026-03-11T20:00:00.000Z' }),
      ],
      now,
      60,
    );

    expect(reminders.map((r) => r.planId)).toEqual(['sooner', 'later']);
  });

  it('ignores an unparseable start time rather than throwing', () => {
    expect(plannedReminders([makePlan({ startsAt: 'not a date' })], now, 60)).toEqual([]);
  });
});
