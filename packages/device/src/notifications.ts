/**
 * Local reminders.
 *
 * Local rather than push, for two reasons that both matter here. The copy is
 * composed on the recipient's own device, so each partner is reminded in their
 * own language with no server-side locale lookup. And nothing about the
 * couple's schedule is sent to a push service.
 *
 * The caller passes already-translated strings — this module never touches
 * i18n, so it stays a thin native wrapper.
 */
import * as Notifications from 'expo-notifications';

export interface ReminderInput {
  /** Stable id so rescheduling replaces rather than stacks. */
  key: string;
  title: string;
  body: string;
  at: Date;
}

export async function hasNotificationPermission(): Promise<boolean> {
  const { granted } = await Notifications.getPermissionsAsync();
  return granted;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

/**
 * Notifications are delivered quietly and carry no content in the payload.
 *
 * Anything richer would show intimate detail on a lock screen, which is
 * exactly what this app must not do.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Schedule a reminder, replacing any earlier one with the same key.
 *
 * Reminders in the past are dropped rather than fired immediately — a phone
 * that was off for a week should not buzz five times on wake.
 */
export async function scheduleReminder(input: ReminderInput, now: Date): Promise<string | null> {
  await cancelReminder(input.key);
  if (input.at <= now) return null;

  return Notifications.scheduleNotificationAsync({
    identifier: input.key,
    content: {
      title: input.title,
      body: input.body,
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: input.at,
    },
  });
}

export async function cancelReminder(key: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(key);
  } catch {
    // Nothing scheduled under that key.
  }
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
