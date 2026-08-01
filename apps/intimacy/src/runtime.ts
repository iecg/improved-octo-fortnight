/**
 * Process-wide singletons: the Supabase client, the i18n instance, and
 * device-local preferences.
 */
import { INTIMACY_KINDS, type Locale } from '@couple/core';
import { createSupabaseClient } from '@couple/data';
import { secureAuthStorage } from '@couple/device';
import { addAppNamespace, createI18n, resolveLocale } from '@couple/i18n';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';

import enApp from './locales/en/app.json';
import esApp from './locales/es/app.json';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.\n' +
      'Copy .env.example to .env in apps/intimacy and fill in your Supabase project values.',
  );
}

export const supabase = createSupabaseClient({ url, anonKey, storage: secureAuthStorage });

/**
 * First launch follows the phone's language; once signed in, `profiles.locale`
 * takes over. The two partners are independent — one can read Spanish while
 * the other reads English against the same rows.
 */
export const deviceLocale: Locale = resolveLocale(getLocales()[0]?.languageTag);

export const i18n = createI18n(deviceLocale);
addAppNamespace(i18n, 'app', { en: enApp, es: esApp });

/** The standing rituals a new couple starts with. */
export const DEFAULT_INTIMACY_CADENCES = Object.values(INTIMACY_KINDS);

/**
 * Device-local preferences.
 *
 * These stay off the server deliberately. The calendar label and the app lock
 * protect *this* phone; syncing them would let one partner change the other's
 * settings.
 */
const CALENDAR_LABEL_KEY = 'calendar_label';

export async function getCalendarLabel(): Promise<string | null> {
  return SecureStore.getItemAsync(CALENDAR_LABEL_KEY);
}

export async function setCalendarLabel(label: string): Promise<void> {
  await SecureStore.setItemAsync(CALENDAR_LABEL_KEY, label);
}
