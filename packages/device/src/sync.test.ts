/**
 * Reconciliation passes.
 *
 * `useDeviceSync` itself needs a renderer to test, but the property the hook
 * depends on does not: a pass must be safely abandonable, so that whenever a
 * re-render tears one down the next one finishes the job. That is asserted
 * here directly.
 */
import type { Plan } from '@couple/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./calendar', () => ({
  hasCalendarAccess: vi.fn(),
  writeCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));
vi.mock('./notifications', () => ({
  hasNotificationPermission: vi.fn(),
  cancelAllReminders: vi.fn(),
  scheduleReminder: vi.fn(),
}));

import {
  deleteCalendarEvent,
  hasCalendarAccess,
  updateCalendarEvent,
  writeCalendarEvent,
} from './calendar';
import { cancelAllReminders, hasNotificationPermission, scheduleReminder } from './notifications';
import { reconcileDevice, type DeviceSyncOptions } from './sync';

const ME = 'profile-me';
const NEVER_CANCELLED = () => false;

/** Far enough out that a reminder is always still in the future. */
function bookedPlan(id: string, calendarEventIds: Record<string, string> = {}): Plan {
  return {
    id,
    coupleId: 'couple-1',
    domain: 'intimacy',
    kind: 'intimacy',
    title: null,
    notes: 'private',
    location: null,
    startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    endsAt: null,
    status: 'scheduled',
    createdBy: 'profile-them',
    completedAt: null,
    calendarEventIds,
    createdAt: new Date().toISOString(),
  };
}

function options(plans: Plan[], overrides: Partial<DeviceSyncOptions> = {}): DeviceSyncOptions {
  return {
    plans,
    profileId: ME,
    timeZone: 'America/New_York',
    enabled: true,
    calendarTitleFor: () => 'Evening',
    reminder: { leadMinutes: 120, title: 'Reminder', body: '' },
    onCalendarEvent: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Permissions granted and both devices reachable, unless a test says otherwise.
  vi.mocked(hasCalendarAccess).mockResolvedValue(true);
  vi.mocked(hasNotificationPermission).mockResolvedValue(true);
  vi.mocked(writeCalendarEvent).mockResolvedValue('event-new');
  vi.mocked(updateCalendarEvent).mockResolvedValue(undefined);
  vi.mocked(deleteCalendarEvent).mockResolvedValue(undefined);
  vi.mocked(cancelAllReminders).mockResolvedValue(undefined);
  vi.mocked(scheduleReminder).mockResolvedValue(null);
});

describe('reconcileDevice', () => {
  it('writes an event this device is missing and schedules its reminder', async () => {
    const opts = options([bookedPlan('plan-1')]);

    await reconcileDevice(opts, NEVER_CANCELLED);

    // The neutral label, and nothing else about the plan.
    expect(writeCalendarEvent).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeCalendarEvent).mock.calls[0]![0];
    expect(written.title).toBe('Evening');
    expect(written.notes).toBeUndefined();
    expect(written.location).toBeUndefined();

    expect(opts.onCalendarEvent).toHaveBeenCalledWith(opts.plans[0], 'event-new');
    expect(scheduleReminder).toHaveBeenCalledTimes(1);
  });

  it('moves the existing entry when a plan is rescheduled', async () => {
    const plan = bookedPlan('plan-1', { [ME]: 'my-event' });
    const opts = options([plan]);

    await reconcileDevice(opts, NEVER_CANCELLED);

    // The entry already exists, so nothing new is written and the stored id is
    // untouched — but the OS entry is restated at the plan's current time.
    expect(writeCalendarEvent).not.toHaveBeenCalled();
    expect(opts.onCalendarEvent).not.toHaveBeenCalled();

    expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
    const [eventId, entry] = vi.mocked(updateCalendarEvent).mock.calls[0]!;
    expect(eventId).toBe('my-event');
    expect(entry.startsAt.toISOString()).toBe(plan.startsAt);
    // Still the neutral label, and still nothing else about the plan.
    expect(entry.title).toBe('Evening');
    expect(entry.notes).toBeUndefined();
    expect(entry.location).toBeUndefined();
  });

  it('leaves a completed plan’s entry as history', async () => {
    const plan = { ...bookedPlan('plan-1', { [ME]: 'my-event' }), status: 'completed' as const };

    await reconcileDevice(options([plan]), NEVER_CANCELLED);

    expect(updateCalendarEvent).not.toHaveBeenCalled();
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('does nothing without calendar permission, rather than asking for it', async () => {
    vi.mocked(hasCalendarAccess).mockResolvedValue(false);

    await reconcileDevice(options([bookedPlan('plan-1')]), NEVER_CANCELLED);

    expect(writeCalendarEvent).not.toHaveBeenCalled();
  });

  it('leaves the partner’s event id alone and only writes its own', async () => {
    // The plan already carries the other phone's id. This device still owes one.
    const plan = bookedPlan('plan-1', { 'profile-them': 'their-event' });

    await reconcileDevice(options([plan]), NEVER_CANCELLED);

    expect(writeCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it('stops partway through when cancelled', async () => {
    let calls = 0;
    // Cancelled as soon as the first event is written, the way a re-render
    // triggered by recording that event would.
    const cancelAfterFirst = () => calls > 0;
    vi.mocked(writeCalendarEvent).mockImplementation(async () => {
      calls += 1;
      return `event-${calls}`;
    });

    await reconcileDevice(options([bookedPlan('a'), bookedPlan('b')]), cancelAfterFirst);

    expect(writeCalendarEvent).toHaveBeenCalledTimes(1);
    // Reminders come last, so they are the first casualty of a teardown.
    expect(scheduleReminder).not.toHaveBeenCalled();
  });

  /**
   * The regression that motivated dropping the `lastRun` guard.
   *
   * The old hook recorded a signature as done before the work ran, so a pass
   * cancelled by an unrelated re-render was never retried and its reminders
   * were lost until some plan changed. Abandoning a pass is only safe if the
   * next one finishes what was left, so that is what is pinned here.
   */
  it('finishes the outstanding work on the next pass after a cancelled one', async () => {
    const first = bookedPlan('a');
    const second = bookedPlan('b');
    let calls = 0;
    vi.mocked(writeCalendarEvent).mockImplementation(async () => {
      calls += 1;
      return `event-${calls}`;
    });

    // Pass one is torn down after writing 'a'.
    await reconcileDevice(options([first, second]), () => calls > 0);
    expect(writeCalendarEvent).toHaveBeenCalledTimes(1);
    expect(scheduleReminder).not.toHaveBeenCalled();

    // Pass two sees the world as it now is: 'a' has this device's id, 'b' does
    // not. Nothing is written twice, and the reminders finally land.
    await reconcileDevice(options([bookedPlan('a', { [ME]: 'event-1' }), second]), NEVER_CANCELLED);

    expect(writeCalendarEvent).toHaveBeenCalledTimes(2);
    expect(cancelAllReminders).toHaveBeenCalled();
    expect(scheduleReminder).toHaveBeenCalledTimes(2);
  });

  it('removes an event once the plan is no longer booked', async () => {
    const declined = { ...bookedPlan('plan-1', { [ME]: 'mine' }), status: 'declined' as const };
    const opts = options([declined]);

    await reconcileDevice(opts, NEVER_CANCELLED);

    expect(deleteCalendarEvent).toHaveBeenCalledWith('mine');
    expect(opts.onCalendarEvent).toHaveBeenCalledWith(declined, null);
  });
});
