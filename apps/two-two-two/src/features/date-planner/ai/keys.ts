/**
 * Where the keys live: the device keychain, and nowhere else.
 *
 * iOS Keychain / Android Keystore via `expo-secure-store`. A key is never sent
 * to Supabase, never written to a table, never included in a plan or an idea
 * row, and never shared with the partner — pairing is one account across both
 * apps, but a key is per person, per device. If both partners want
 * suggestions, both configure one.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps the item out of an encrypted iCloud
 * keychain backup, so restoring a phone backup onto a second device does not
 * carry the key with it. That is the right default for a credential the user
 * can re-paste in ten seconds.
 *
 * Calling `SecureStore` directly rather than through `secureAuthStorage` in
 * `@couple/device` is deliberate twice over: that helper is the Supabase
 * session adapter, with chunking these short values do not need, and
 * `packages/device` has no `features/<name>/ai/` segment in its path, so a
 * provider key name there would fail the guard in
 * `tests/guards/ai-optional.test.ts`. `packages/device/src/lock.ts` sets the
 * precedent for a module owning its own items.
 */
import * as SecureStore from 'expo-secure-store';

import { AI_PROVIDERS, type AiProviderId } from './providers';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * Which provider the user last chose. Not a secret, but keeping it here avoids
 * adding a second storage mechanism for one enum.
 */
const SELECTED_ITEM = 'ai_selected_provider';

function isProviderId(value: string | null): value is AiProviderId {
  return value !== null && value in AI_PROVIDERS;
}

export async function readProviderKey(provider: AiProviderId): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AI_PROVIDERS[provider].keyItem, OPTIONS);
  } catch {
    // An unreadable keychain is indistinguishable from an empty one as far as
    // this feature is concerned: either way there is no key to use, and the
    // rest of the ideas screen carries on working.
    return null;
  }
}

export async function writeProviderKey(provider: AiProviderId, key: string): Promise<void> {
  await SecureStore.setItemAsync(AI_PROVIDERS[provider].keyItem, key.trim(), OPTIONS);
}

export async function clearProviderKey(provider: AiProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(AI_PROVIDERS[provider].keyItem, OPTIONS);
}

/** A user-set model id, or null to use the catalog default. */
export async function readProviderModel(provider: AiProviderId): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AI_PROVIDERS[provider].modelItem, OPTIONS);
  } catch {
    return null;
  }
}

export async function writeProviderModel(provider: AiProviderId, model: string): Promise<void> {
  const trimmed = model.trim();
  if (trimmed.length === 0) {
    await SecureStore.deleteItemAsync(AI_PROVIDERS[provider].modelItem, OPTIONS);
    return;
  }
  await SecureStore.setItemAsync(AI_PROVIDERS[provider].modelItem, trimmed, OPTIONS);
}

export async function readSelectedProvider(): Promise<AiProviderId | null> {
  try {
    const stored = await SecureStore.getItemAsync(SELECTED_ITEM, OPTIONS);
    return isProviderId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function writeSelectedProvider(provider: AiProviderId): Promise<void> {
  await SecureStore.setItemAsync(SELECTED_ITEM, provider, OPTIONS);
}
