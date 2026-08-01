/**
 * Locale- and timezone-aware formatting.
 *
 * Every date the user sees goes through here. Two partners can read the same
 * instant in different languages, so the locale is always an argument — never
 * ambient state — and the timezone is always the couple's, never the device's.
 */
import type { IntervalUnit, Locale } from '@couple/core';
import { enUS, es } from 'date-fns/locale';
import type { Locale as DateFnsLocale } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = { en: enUS, es };

/** `Feb 14, 2026` / `14 feb 2026` */
export function formatDay(date: Date, locale: Locale, timeZone: string): string {
  return formatInTimeZone(date, timeZone, 'PP', { locale: DATE_FNS_LOCALES[locale] });
}

/** `Saturday, February 14` / `sábado, 14 de febrero` */
export function formatWeekday(date: Date, locale: Locale, timeZone: string): string {
  return formatInTimeZone(date, timeZone, 'EEEE, d MMMM', {
    locale: DATE_FNS_LOCALES[locale],
  });
}

/** `8:00 PM` / `20:00` */
export function formatTime(date: Date, locale: Locale, timeZone: string): string {
  return formatInTimeZone(date, timeZone, 'p', { locale: DATE_FNS_LOCALES[locale] });
}

/** `Feb 14, 2026, 8:00 PM` / `14 feb 2026, 20:00` */
export function formatDayTime(date: Date, locale: Locale, timeZone: string): string {
  return formatInTimeZone(date, timeZone, 'PPp', { locale: DATE_FNS_LOCALES[locale] });
}

/**
 * Parts for a time window. Returned as pieces rather than a joined string so
 * the separator comes from a translation key — punctuation and word order
 * differ between languages, and joining here would bake English into the
 * formatter.
 */
export function formatWindowParts(
  start: Date,
  end: Date,
  locale: Locale,
  timeZone: string,
): { start: string; end: string; sameDay: boolean } {
  const startDay = formatInTimeZone(start, timeZone, 'yyyy-MM-dd');
  const endDay = formatInTimeZone(end, timeZone, 'yyyy-MM-dd');
  const sameDay = startDay === endDay;

  return {
    start: sameDay
      ? `${formatWeekday(start, locale, timeZone)}, ${formatTime(start, locale, timeZone)}`
      : formatDayTime(start, locale, timeZone),
    end: sameDay ? formatTime(end, locale, timeZone) : formatDayTime(end, locale, timeZone),
    sameDay,
  };
}

/** The `YYYY-MM-DD` the couple would call "today". */
export function calendarDateIn(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
}

/**
 * Map a day count to a translation key and its interpolation count.
 *
 * The cadence engine returns numbers only; turning them into "3 days overdue"
 * versus "hace 3 días que tocaba" is this layer's job, and pluralization is
 * left to i18next rather than string concatenation.
 */
export function dueTranslation(daysUntilDue: number): { key: string; count: number } {
  if (daysUntilDue < 0) {
    return { key: 'cadence:due.overdue', count: Math.abs(daysUntilDue) };
  }
  if (daysUntilDue === 0) return { key: 'cadence:due.today', count: 0 };
  if (daysUntilDue === 1) return { key: 'cadence:due.tomorrow', count: 1 };
  return { key: 'cadence:due.in', count: daysUntilDue };
}

export function intervalTranslation(
  value: number,
  unit: IntervalUnit,
): { key: string; count: number } {
  return { key: `cadence:interval.every_${unit}`, count: value };
}
