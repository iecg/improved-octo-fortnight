/**
 * Domain types shared by every app in this repo.
 *
 * These mirror the tables in `supabase/migrations`. Two invariants hold
 * throughout:
 *
 *  1. Every value stored in the database is an English machine token
 *     (`'not_tonight'`, `'date_night'`). Display strings are produced by the
 *     i18n layer from these tokens. Never store a translated string.
 *  2. `domain` namespaces every app's vocabulary. The cadence engine does
 *     interval arithmetic and never interprets `kind`, so adding an app is a
 *     TypeScript change, not a migration.
 */

/** Which app a row belongs to. Values are open-ended by design — see `AppDomain`. */
export const APP_DOMAINS = ['intimacy', 'two_two_two'] as const;
export type AppDomain = (typeof APP_DOMAINS)[number];

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const INTERVAL_UNITS = ['day', 'week', 'month', 'year'] as const;
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];

export const PLAN_STATUSES = [
  'idea',
  'proposed',
  'scheduled',
  'completed',
  'skipped',
  'declined',
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PROPOSAL_RESPONSES = ['pending', 'accepted', 'declined', 'countered'] as const;
export type ProposalResponse = (typeof PROPOSAL_RESPONSES)[number];

export const CHECKIN_INTERESTS = ['yes', 'maybe', 'not_tonight'] as const;
export type CheckinInterest = (typeof CHECKIN_INTERESTS)[number];

export interface Profile {
  id: string;
  displayName: string | null;
  timezone: string;
  locale: Locale;
}

export interface Couple {
  id: string;
  inviteCode: string;
  anniversaryDate: string | null;
  timezone: string;
  createdAt: string;
}

export interface Cadence {
  id: string;
  coupleId: string;
  domain: AppDomain;
  /** App-specific token; see the kind catalogs in `./kinds`. */
  kind: string;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  enabled: boolean;
}

export interface Plan {
  id: string;
  coupleId: string;
  domain: AppDomain;
  kind: string;
  title: string | null;
  notes: string | null;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: PlanStatus;
  /** Null only when the author deleted their account; the plan survives. */
  createdBy: string | null;
  completedAt: string | null;
  /**
   * Map of `profileId -> device calendar event id`. Each partner's phone
   * returns its own identifier for the same logical event, so this cannot be a
   * single column.
   */
  calendarEventIds: Record<string, string>;
  createdAt: string;
}

export interface PlanProposal {
  id: string;
  planId: string;
  proposedBy: string;
  startsAt: string;
  endsAt: string;
  response: ProposalResponse;
  respondedAt: string | null;
  /** Set when this proposal is a counter to an earlier one, forming a chain. */
  counteredFrom: string | null;
  createdAt: string;
}

/**
 * Where an idea came from.
 *
 * `library` is the bundled curated set and `manual` is written by a partner —
 * between them the feature works with no model configured anywhere, which is
 * the whole point of the 2-2-2 app's AI-optional rule. `ai` is the optional
 * third case.
 */
export const IDEA_SOURCES = ['library', 'manual', 'ai'] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];

export const COST_BANDS = ['free', 'low', 'medium', 'high'] as const;
export type CostBand = (typeof COST_BANDS)[number];

/** A saved suggestion. 2-2-2-owned; the intimacy app has no accessor for these. */
export interface PlanIdea {
  id: string;
  coupleId: string;
  domain: AppDomain;
  kind: string;
  /** Shown verbatim. Partner-written or model-written, never re-translated. */
  title: string;
  summary: string | null;
  url: string | null;
  estCostBand: CostBand | null;
  source: IdeaSource;
  /**
   * The language this idea's text is written in. Ideas are labelled rather
   * than machine-translated, exactly as with any other authored text.
   */
  locale: Locale;
  /** Null once the person who saved it deletes their account. */
  savedBy: string | null;
  createdAt: string;
}

export interface Checkin {
  id: string;
  coupleId: string;
  profileId: string;
  /** Calendar date in the couple's timezone, `YYYY-MM-DD`. */
  onDate: string;
  interest: CheckinInterest;
  energy: number | null;
  note: string | null;
  createdAt: string;
}
