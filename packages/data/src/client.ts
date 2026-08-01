import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

export type AppSupabaseClient = SupabaseClient<Database>;

/**
 * Where the auth session is persisted.
 *
 * Injected rather than imported so this package stays free of native modules
 * and runs under plain Node in tests. The intimacy app passes an
 * `expo-secure-store` adapter — the session is a bearer token for everything
 * in here, so it belongs in the keychain, not in AsyncStorage.
 */
export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  storage: AuthStorage;
}

export function createSupabaseClient(config: SupabaseConfig): AppSupabaseClient {
  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      storage: config.storage,
      autoRefreshToken: true,
      persistSession: true,
      // There is no URL bar on a phone; the OAuth callback is handled by
      // expo-linking instead.
      detectSessionInUrl: false,
    },
  });
}
