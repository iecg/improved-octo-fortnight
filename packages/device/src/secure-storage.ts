/**
 * Auth session storage backed by the device keychain.
 *
 * The Supabase session is a bearer token for everything in this app, so it
 * belongs in SecureStore rather than AsyncStorage. SecureStore has a ~2 KB
 * value limit on iOS and sessions can exceed it once a JWT carries claims, so
 * values are chunked rather than silently truncated.
 */
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800;
const COUNT_SUFFIX = '__chunks';

/** SecureStore keys allow only alphanumerics, `.`, `-` and `_`. */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(`${key}${COUNT_SUFFIX}`);
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const secureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const base = safeKey(key);
    const count = await readCount(base);
    if (count === 0) return SecureStore.getItemAsync(base);

    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(`${base}.${index}`);
      // A missing chunk means a partially written session; treat it as absent
      // so the user is asked to sign in again rather than handed a torn token.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const base = safeKey(key);
    await this.removeItem(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(base, value);
      return;
    }

    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }
    for (const [index, chunk] of chunks.entries()) {
      await SecureStore.setItemAsync(`${base}.${index}`, chunk);
    }
    // Written last, so a crash mid-write leaves no count and the session reads
    // as absent rather than as a short value.
    await SecureStore.setItemAsync(`${base}${COUNT_SUFFIX}`, String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const base = safeKey(key);
    const count = await readCount(base);
    await SecureStore.deleteItemAsync(base);
    await SecureStore.deleteItemAsync(`${base}${COUNT_SUFFIX}`);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.deleteItemAsync(`${base}.${index}`);
    }
  },
};
