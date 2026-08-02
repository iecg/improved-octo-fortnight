/**
 * Small per-install preferences.
 *
 * Stored on the device rather than the server, for the same reason the app
 * lock is (`./lock`): these describe *this* install on *this* phone. Syncing
 * them would let one partner dismiss a notice the other has not seen, or
 * re-show one they already read.
 *
 * `expo-secure-store` is the keychain and is slower than it looks, so this is
 * for flags and short strings only — never for anything that belongs in a
 * query cache.
 */
import * as SecureStore from 'expo-secure-store';

/**
 * Whether this install has shown the "one account, both apps" notice.
 *
 * Per install rather than per person: each app has its own SecureStore
 * sandbox, so the same key naturally tracks the two apps separately and
 * installing the second one still explains itself.
 */
const CONNECTED_APPS_SEEN_KEY = 'connected_apps_notice_seen';

export async function hasSeenConnectedAppsNotice(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CONNECTED_APPS_SEEN_KEY)) === 'true';
}

export async function markConnectedAppsNoticeSeen(): Promise<void> {
  await SecureStore.setItemAsync(CONNECTED_APPS_SEEN_KEY, 'true');
}
