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
  deleteCalendarEvent: vi.fn(),
}));
vi.mock('./notifications', () => ({
  hasNotificationPermission: vi.fn(),
  cancelAllReminders: vi.fn(),
  scheduleReminder: vi.fn(),
}));

import { deleteCalendarEvent, hasCalendarAccess, writeCalendarEvent } from './calendar';
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
  vi.mocked(deleteCalendarEvent).mockResolvedValue(undefined);
  vi.mocked(cancelAllReminders).mockResolvedValue(undefined);
  vi.mocked(scheduleReminder).mockResolvedValue(null);
});

describe('reconcileDevice', () => {
  it('writes an event this device is missing and schedules its reminder', async () => {
    const opts = options([bookedPlan('plan-1')]);

    await reconcileDevice(opts, NEVER_CANCELLED);

    // The neutral label, and nothing else about the plan. No
    // `calendarLocationFor` was supplied, which is how the intimacy app calls
    // this and what every caller gets by default.
    expect(writeCalendarEvent).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeCalendarEvent).mock.calls[0]![0];
    expect(written.title).toBe('Evening');
    expect(written.notes).toBeUndefined();
    expect(written.location).toBeUndefined();

    expect(opts.onCalendarEvent).toHaveBeenCalledWith(opts.plans[0], 'event-new');
    expect(scheduleReminder).toHaveBeenCalledTimes(1);
  });

  it('writes an address only when the app supplies one', async () => {
    await reconcileDevice(
      options([bookedPlan('plan-1')], {
        calendarLocationFor: () => 'Carrer dels Almogàvers 1, Barcelona',
      }),
      NEVER_CANCELLED,
    );

    const written = vi.mocked(writeCalendarEvent).mock.calls[0]![0];
    expect(written.location).toBe('Carrer dels Almogàvers 1, Barcelona');
    // Still nothing else — an address is the only thing being opted into.
    expect(written.notes).toBeUndefined();
  });

  it('writes nothing when the opt-in callback declines for this plan', async () => {
    // A place exists on some plans and not others, and a place that was never
    // opted in answers undefined. That must be indistinguishable from having no
    // callback at all.
    await reconcileDevice(
      options([bookedPlan('plan-1')], { calendarLocationFor: () => undefined }),
      NEVER_CANCELLED,
    );

    expect(vi.mocked(writeCalendarEvent).mock.calls[0]![0].location).toBeUndefined();
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
