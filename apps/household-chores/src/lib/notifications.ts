import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Requests notification permission, registers this device's Expo push
 * token, and upserts it against the current user in `push_tokens`.
 *
 * Requires a physical device and an EAS project ID (set once you run
 * `eas init`; until then this no-ops with a console warning rather than
 * throwing, so development without a linked EAS project isn't blocked).
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device; skipping registration.');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Notification permission not granted.');
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn(
      'No EAS projectId configured (run `eas init`); skipping push token registration.'
    );
    return null;
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResponse.data;

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userData.user.id, token, device_id: `${Platform.OS}-${Device.modelName ?? 'unknown'}` },
      { onConflict: 'token' }
    );

  if (error) {
    console.warn('Failed to save push token:', error.message);
    return null;
  }

  return token;
}
