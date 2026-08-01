/**
 * Formatting helpers, re-exported so screens have one import for everything
 * locale-related.
 *
 * Nothing here builds a user-visible string by hand: the shared helpers return
 * either a formatted date for the viewer's locale, or a translation key plus
 * its interpolation count for i18next to pluralize.
 */
export {
  calendarDateIn,
  dueTranslation,
  formatDay,
  formatDayTime,
  formatTime,
  formatWeekday,
  formatWindowParts,
  intervalTranslation,
} from '@couple/i18n';

export { kindDescriptionKey, kindLabelKey } from '@couple/core';

import { kindLabelKey } from '@couple/core';
import type { AppDomain } from '@couple/core';

/**
 * Cadence statuses carry `domain` as a plain string, so this narrows it back
 * for the key builder at the one place it is needed.
 */
export function kindLabelKeyFor(domain: string, kind: string): string {
  return kindLabelKey(domain as AppDomain, kind);
}
