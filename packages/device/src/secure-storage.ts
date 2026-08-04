/**
 * Keychain-backed storage, chunked.
 *
 * SecureStore has a ~2 KB value limit on iOS. A Supabase session exceeds it
 * once a JWT carries claims, so values are split rather than silently
 * truncated. The couple key is nowhere near that size, but it shares the store
 * because the chunking is invisible below the limit and one implementation is
 * one set of edge cases.
 *
 * `createChunkedStore` takes `SecureStoreOptions` so callers can choose *when*
 * the keychain will hand an item back — see `key-vault.ts`, where the two keys
 * it stores deliberately differ.
 */
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800;
const COUNT_SUFFIX = '__chunks';

/** SecureStore keys allow only alphanumerics, `.`, `-` and `_`. */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export interface ChunkedStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Every member is a closure over `options` rather than a method on an object
 * literal, so `const { setItem } = store` keeps working. The previous version
 * called `this.removeItem` from inside `setItem`, which meant destructuring it —
 * something the `AuthStorage` interface it satisfies gives no hint against —
 * threw at runtime rather than at compile time.
 */
export function createChunkedStore(options?: SecureStore.SecureStoreOptions): ChunkedStore {
  async function readCount(base: string): Promise<number> {
    const raw = await SecureStore.getItemAsync(`${base}${COUNT_SUFFIX}`, options);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  async function removeItem(key: string): Promise<void> {
    const base = safeKey(key);
    const count = await readCount(base);
    await SecureStore.deleteItemAsync(base, options);
    await SecureStore.deleteItemAsync(`${base}${COUNT_SUFFIX}`, options);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.deleteItemAsync(`${base}.${index}`, options);
    }
  }

  return {
    async getItem(key) {
      const base = safeKey(key);
      const count = await readCount(base);
      if (count === 0) return SecureStore.getItemAsync(base, options);

      const parts: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const part = await SecureStore.getItemAsync(`${base}.${index}`, options);
        // A missing chunk means a partially written value; treat it as absent
        // so the user is asked to sign in again rather than handed a torn token.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      const base = safeKey(key);
      await removeItem(key);

      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(base, value, options);
        return;
      }

      const chunks: string[] = [];
      for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
        chunks.push(value.slice(offset, offset + CHUNK_SIZE));
      }
      for (const [index, chunk] of chunks.entries()) {
        await SecureStore.setItemAsync(`${base}.${index}`, chunk, options);
      }
      // Written last, so a crash mid-write leaves no count and the value reads
      // as absent rather than as a short one.
      await SecureStore.setItemAsync(`${base}${COUNT_SUFFIX}`, String(chunks.length), options);
    },

    removeItem,
  };
}

/**
 * Auth session storage.
 *
 * The Supabase session is a bearer token for everything in this app, so it
 * belongs in the keychain rather than in AsyncStorage. Default accessibility —
 * `WHEN_UNLOCKED` — because a background refresh of an access token is not
 * something this app does.
 */
export const secureAuthStorage: ChunkedStore = createChunkedStore();
