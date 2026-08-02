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

/**
 * Whether this install may see times the couple is busy in the *other* app.
 *
 * Off until someone turns it on, and read only by the 2-2-2 app. The asymmetry
 * is deliberate. Free/busy taken from the phone's own calendar needs no
 * setting — those events are already in the stock Calendar app, and the
 * intimacy app writes only a neutral label to them. The server feed is a
 * different thing: it shows occupied windows to a phone whose owner refused
 * calendar access, and 2-2-2 is the app you would hand to a friend to show
 * them a trip. That is worth asking about once.
 *
 * It is per device, not per couple, for the same reason the app lock is: it
 * protects this phone in this room, and syncing it would let one partner make
 * that call for the other.
 *
 * Even switched on it reveals times and never what fills them — the view it
 * gates carries no title, no notes and no domain. The setting is about who
 * gets to see the shape of an evening, not what happened in it.
 */
const CROSS_APP_BUSY_KEY = 'cross_app_busy_enabled';

export async function isCrossAppBusyEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CROSS_APP_BUSY_KEY)) === 'true';
}

export async function setCrossAppBusyEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(CROSS_APP_BUSY_KEY, enabled ? 'true' : 'false');
}
