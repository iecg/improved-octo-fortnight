/**
 * Kind catalogs.
 *
 * Kinds live in TypeScript rather than a Postgres enum on purpose: the cadence
 * engine treats `kind` as an opaque token, so a new app — or a new ritual
 * inside an existing app — costs a constant here and two translation keys,
 * never a migration.
 *
 * Every catalog entry carries the *default* cadence only. Couples edit their
 * own intervals, so nothing downstream may assume "date night" means two
 * weeks.
 */
import type { AppDomain, IntervalUnit } from './domain';

export interface KindDefinition {
  domain: AppDomain;
  kind: string;
  defaultIntervalValue: number;
  defaultIntervalUnit: IntervalUnit;
  /**
   * Whether this kind is a standing ritual (gets a cadence row and a countdown)
   * or only ever exists as a one-off plan.
   */
  recurring: boolean;
}

/**
 * Intimacy app. Deliberately short cadences, and deliberately few of them —
 * this app is about one recurring thing done well, not a ritual taxonomy.
 */
export const INTIMACY_KINDS = {
  /** The core standing slot. */
  intimacy: {
    domain: 'intimacy',
    kind: 'intimacy',
    defaultIntervalValue: 1,
    defaultIntervalUnit: 'week',
    recurring: true,
  },
  /** A longer, unhurried block — the thing that never happens without a plan. */
  extended: {
    domain: 'intimacy',
    kind: 'extended',
    defaultIntervalValue: 1,
    defaultIntervalUnit: 'month',
    recurring: true,
  },
  /** Non-physical closeness: an unrushed conversation with phones away. */
  connection: {
    domain: 'intimacy',
    kind: 'connection',
    defaultIntervalValue: 1,
    defaultIntervalUnit: 'week',
    recurring: true,
  },
} as const satisfies Record<string, KindDefinition>;

export type IntimacyKind = keyof typeof INTIMACY_KINDS;

/**
 * 2-2-2 app: date night every 2 weeks, getaway every 2 months, trip every 2
 * years. Stored as data so a couple can run 3-3-3 without a code change.
 */
export const TWO_TWO_TWO_KINDS = {
  date_night: {
    domain: 'two_two_two',
    kind: 'date_night',
    defaultIntervalValue: 2,
    defaultIntervalUnit: 'week',
    recurring: true,
  },
  getaway: {
    domain: 'two_two_two',
    kind: 'getaway',
    defaultIntervalValue: 2,
    defaultIntervalUnit: 'month',
    recurring: true,
  },
  trip: {
    domain: 'two_two_two',
    kind: 'trip',
    defaultIntervalValue: 2,
    defaultIntervalUnit: 'year',
    recurring: true,
  },
} as const satisfies Record<string, KindDefinition>;

export type TwoTwoTwoKind = keyof typeof TWO_TWO_TWO_KINDS;

const CATALOGS: Record<AppDomain, Record<string, KindDefinition>> = {
  intimacy: INTIMACY_KINDS,
  two_two_two: TWO_TWO_TWO_KINDS,
};

/** Every kind an app knows about, in display order. */
export function kindsForDomain(domain: AppDomain): KindDefinition[] {
  return Object.values(CATALOGS[domain]);
}

export function findKind(domain: AppDomain, kind: string): KindDefinition | undefined {
  return CATALOGS[domain][kind];
}

/**
 * Translation key for a kind's label. Kept here so the key shape is defined
 * once and both apps — and the parity test — agree on it.
 */
export function kindLabelKey(domain: AppDomain, kind: string): string {
  return `cadence:kind.${domain}.${kind}.label`;
}

export function kindDescriptionKey(domain: AppDomain, kind: string): string {
  return `cadence:kind.${domain}.${kind}.description`;
}
