import type { Locale } from '@couple/core';

import enCadence from './locales/en/cadence.json';
import enCommon from './locales/en/common.json';
import enPlans from './locales/en/plans.json';
import esCadence from './locales/es/cadence.json';
import esCommon from './locales/es/common.json';
import esPlans from './locales/es/plans.json';

/**
 * Namespaces shared by every app. Apps add their own with
 * `i18n.addResourceBundle`, so nothing app-specific belongs here.
 */
export const SHARED_NAMESPACES = ['common', 'cadence', 'plans'] as const;
export type SharedNamespace = (typeof SHARED_NAMESPACES)[number];

export const resources: Record<Locale, Record<SharedNamespace, object>> = {
  en: { common: enCommon, cadence: enCadence, plans: enPlans },
  es: { common: esCommon, cadence: esCadence, plans: esPlans },
};
