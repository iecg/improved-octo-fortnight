/**
 * Process-wide singletons for the 2-2-2 app.
 *
 * Deliberately parallel to `apps/intimacy/src/runtime.ts`: same Supabase
 * project, same account, same pairing. Only the domain and the kind catalog
 * differ.
 */
import { TWO_TWO_TWO_KINDS, type Locale } from '@couple/core';
import { createSupabaseClient } from '@couple/data';
import { secureAuthStorage } from '@couple/device';
import { addAppNamespace, createI18n, resolveLocale } from '@couple/i18n';
import { getLocales } from 'expo-localization';

import enApp from './locales/en/app.json';
import enIdeas from './locales/en/ideas.json';
import esApp from './locales/es/app.json';
import esIdeas from './locales/es/ideas.json';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.\n' +
      'Copy .env.example to .env in apps/two-two-two and fill in your Supabase project values.',
  );
}

export const supabase = createSupabaseClient({ url, anonKey, storage: secureAuthStorage });

export const deviceLocale: Locale = resolveLocale(getLocales()[0]?.languageTag);

export const i18n = createI18n(deviceLocale);
addAppNamespace(i18n, 'app', { en: enApp, es: esApp });
// The curated library is ours, not a partner's, so it is translated like any
// other chrome rather than labelled with the language it was written in.
addAppNamespace(i18n, 'ideas', { en: enIdeas, es: esIdeas });

/** Date night every 2 weeks, a getaway every 2 months, a trip every 2 years. */
export const DEFAULT_CADENCES = Object.values(TWO_TWO_TWO_KINDS);
