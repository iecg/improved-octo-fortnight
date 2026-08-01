/**
 * App lock.
 *
 * Face ID or a passcode on launch and on return to the foreground. The setting
 * is stored on the device rather than the server: it protects this phone, and
 * syncing it would let one partner turn off the other's lock.
 *
 * `deviceHasBiometrics` and `isLockAvailable` are deliberately separate. A
 * device with a passcode but no enrolled biometrics can still lock the app —
 * refusing to offer it there would be a downgrade for no reason.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const LOCK_ENABLED_KEY = 'app_lock_enabled';

export async function deviceHasBiometrics(): Promise<boolean> {
  return (
    (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
  );
}

/** True when the device can authenticate at all — biometrics or a passcode. */
export async function isLockAvailable(): Promise<boolean> {
  if (await deviceHasBiometrics()) return true;
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level !== LocalAuthentication.SecurityLevel.NONE;
}

export async function isLockEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LOCK_ENABLED_KEY)) === 'true';
}

export async function setLockEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(LOCK_ENABLED_KEY, enabled ? 'true' : 'false');
}

/**
 * Prompt for authentication.
 *
 * `promptMessage` is passed in already translated — this module never touches
 * i18n. Falling back to the device passcode matters: biometrics fail often
 * enough (wet hands, a mask) that a hard failure would lock people out of
 * their own app.
 */
export async function authenticate(promptMessage: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    disableDeviceFallback: false,
  });
  return result.success;
}
