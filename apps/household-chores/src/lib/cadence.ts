// Pure cadence math, mirroring the SQL `is_chore_due` function in
// supabase/migrations/20260807152703_rls_and_rpcs.sql. Kept in sync
// intentionally: this copy powers client-side previews (e.g. "next 5 due
// dates" in the chore editor) and is unit-tested in isolation, while the
// SQL copy is the source of truth actually used for instance generation.
//
// Dates are represented as 'YYYY-MM-DD' strings throughout (matching
// Postgres `date` columns) to avoid timezone drift from JS Date's implicit
// local-time parsing.

import type { CadenceConfig, CadenceType } from '@/types';

export function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayDateOnly(): string {
  return formatDateOnly(new Date());
}

export function addDays(dateStr: string, days: number): string {
  const date = parseDateOnly(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseDateOnly(b).getTime() - parseDateOnly(a).getTime()) / msPerDay);
}

function lastDayOfMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Mirrors SQL `is_chore_due`. */
export function isChoreDue(
  cadenceType: CadenceType,
  cadenceConfig: CadenceConfig,
  startDate: string,
  checkDate: string
): boolean {
  if (checkDate < startDate) return false;

  switch (cadenceType) {
    case 'daily':
      return true;
    case 'weekly_days': {
      const weekdays = (cadenceConfig as { weekdays: number[] }).weekdays ?? [];
      const dow = parseDateOnly(checkDate).getUTCDay();
      return weekdays.includes(dow);
    }
    case 'every_n_days': {
      const n = Math.max((cadenceConfig as { n: number }).n ?? 1, 1);
      return daysBetween(startDate, checkDate) % n === 0;
    }
    case 'monthly': {
      const dayOfMonth = (cadenceConfig as { day_of_month: number }).day_of_month ?? 1;
      const check = parseDateOnly(checkDate);
      const effectiveDay = Math.min(dayOfMonth, lastDayOfMonth(check));
      return check.getUTCDate() === effectiveDay;
    }
    default:
      return false;
  }
}

/** Preview the next `count` due dates for a chore, starting from `from` (inclusive). */
export function nextDueDates(
  cadenceType: CadenceType,
  cadenceConfig: CadenceConfig,
  startDate: string,
  from: string,
  count: number
): string[] {
  const dates: string[] = [];
  let cursor = from < startDate ? startDate : from;
  // Cap the scan so a misconfigured cadence (e.g. weekdays: []) can't spin forever.
  const maxScanDays = 366 * 2;
  let scanned = 0;

  while (dates.length < count && scanned < maxScanDays) {
    if (isChoreDue(cadenceType, cadenceConfig, startDate, cursor)) {
      dates.push(cursor);
    }
    cursor = addDays(cursor, 1);
    scanned += 1;
  }

  return dates;
}

/** Mirrors the round-robin assignee resolution in `ensure_todays_instances`. */
export function resolveRotatingAssignee(memberIds: string[], nextPosition: number): string | null {
  if (memberIds.length === 0) return null;
  return memberIds[nextPosition % memberIds.length];
}

export function describeCadence(cadenceType: CadenceType, cadenceConfig: CadenceConfig): string {
  switch (cadenceType) {
    case 'daily':
      return 'Every day';
    case 'weekly_days': {
      const weekdays = (cadenceConfig as { weekdays: number[] }).weekdays ?? [];
      if (weekdays.length === 0) return 'Select weekdays';
      const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return weekdays
        .slice()
        .sort((a, b) => a - b)
        .map((d) => labels[d])
        .join(', ');
    }
    case 'every_n_days': {
      const n = (cadenceConfig as { n: number }).n ?? 1;
      return n === 1 ? 'Every day' : `Every ${n} days`;
    }
    case 'monthly': {
      const day = (cadenceConfig as { day_of_month: number }).day_of_month ?? 1;
      return `Monthly on day ${day}`;
    }
    default:
      return '';
  }
}
