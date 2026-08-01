/**
 * i18n bootstrap.
 *
 * Deliberately free of native imports so this package runs under plain Node in
 * tests. The app supplies the starting locale (from `expo-localization` on
 * first launch, then from `profiles.locale` once signed in).
 */
import { LOCALES, type Locale } from '@couple/core';
import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { SHARED_NAMESPACES, resources } from './resources';

export * from './format';
export { SHARED_NAMESPACES, resources } from './resources';
export type { SharedNamespace } from './resources';

export const FALLBACK_LOCALE: Locale = 'en';

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

/**
 * Narrow a device locale tag (`es-MX`, `en-GB`) to one we ship. Unknown tags
 * fall back rather than throwing — a device set to French should get English,
 * not a crash.
 */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return FALLBACK_LOCALE;
  const base = tag.split('-')[0]?.toLowerCase();
  return isSupportedLocale(base) ? base : FALLBACK_LOCALE;
}

export function createI18n(initialLocale: Locale = FALLBACK_LOCALE): I18nInstance {
  const instance = i18next.createInstance();

  void instance.use(initReactI18next).init({
    resources,
    lng: initialLocale,
    fallbackLng: FALLBACK_LOCALE,
    defaultNS: 'common',
    ns: [...SHARED_NAMESPACES],
    // React already escapes everything it renders; escaping again would turn
    // a partner's apostrophe into `&#39;`.
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  return instance;
}

/**
 * Register an app-specific namespace in both languages.
 *
 * Apps own their own copy; only `common`, `cadence`, and `plans` are shared.
 */
export function addAppNamespace(
  instance: I18nInstance,
  namespace: string,
  bundles: Record<Locale, object>,
): void {
  for (const locale of LOCALES) {
    instance.addResourceBundle(locale, namespace, bundles[locale], true, true);
  }
}
