/**
 * Process-wide singletons for the 2-2-2 app.
 *
 * Deliberately parallel to `apps/intimacy/src/runtime.ts`: same Supabase
 * project, same account, same pairing. Only the domain and the kind catalog
 * differ.
 */
import { TWO_TWO_TWO_KINDS, type Locale } from '@couple/core';
import { createSupabaseClient } from '@couple/data';
import { createCoupleKeyStore, createFieldCipher } from '@couple/crypto';
import { deviceRandom, secureAuthStorage } from '@couple/device';
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

/**
 * The couple key, and the two ciphers built over it.
 *
 * The store starts empty and is filled in once a device has unwrapped the key.
 * That indirection exists because the repositories below are module-level
 * singletons, so a cipher has to be constructible before any key exists — and
 * because the alternative, passing a scope per call, is the exact shape
 * invariant 2 forbids.
 *
 * Asking either cipher to work before the key arrives throws
 * `MissingCoupleKeyError`. The router is what makes that unreachable: a paired
 * session with no key does not route to a screen that reads rows.
 */
export const keyStore = createCoupleKeyStore();

/** This app's own rows. A `two_two_two` cipher cannot open the other app's. */
export const contentCipher = createFieldCipher(keyStore, 'two_two_two', deviceRandom);

/** Rows both apps read — today just a partner's name. */
export const sharedCipher = createFieldCipher(keyStore, 'shared', deviceRandom);

export const deviceLocale: Locale = resolveLocale(getLocales()[0]?.languageTag);

export const i18n = createI18n(deviceLocale);
addAppNamespace(i18n, 'app', { en: enApp, es: esApp });
// The curated library is ours, not a partner's, so it is translated like any
// other chrome rather than labelled with the language it was written in.
addAppNamespace(i18n, 'ideas', { en: enIdeas, es: esIdeas });

/** Date night every 2 weeks, a getaway every 2 months, a trip every 2 years. */
export const DEFAULT_CADENCES = Object.values(TWO_TWO_TWO_KINDS);
