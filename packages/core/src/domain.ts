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
 * between them the feature works with nothing configured anywhere, which is the
 * whole point of the 2-2-2 app's AI-optional and maps-optional rules. `ai` and
 * `places` are the optional cases: each needs a key, and each simply never
 * appears without one.
 */
export const IDEA_SOURCES = ['library', 'manual', 'ai', 'places'] as const;
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
  /** Which provider named this, for the sources that came from one. */
  sourceDomain: string | null;
  /**
   * The language this idea's text is written in. Ideas are labelled rather
   * than machine-translated, exactly as with any other authored text.
   */
  locale: Locale;
  /** Null once the person who saved it deletes their account. */
  savedBy: string | null;
  createdAt: string;
}

/**
 * Where a place's details came from.
 *
 * `manual` is a partner typing a venue name, and it is the only provider that
 * exists with no mapping key configured. Everything downstream must keep
 * working when it is the only one it ever sees.
 */
export const PLACE_PROVIDERS = ['manual', 'google'] as const;
export type PlaceProvider = (typeof PLACE_PROVIDERS)[number];

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** A venue attached to a 2-2-2 plan or idea. The intimacy app has no accessor. */
export interface PlanPlace {
  id: string;
  coupleId: string;
  domain: AppDomain;
  /** Exactly one of these is set; the table enforces it. */
  planId: string | null;
  ideaId: string | null;
  /** Shown verbatim. A proper noun, so it is never labelled with a language. */
  name: string;
  /** Labelled with `locale` when it differs from the reader's, like an idea. */
  address: string | null;
  provider: PlaceProvider;
  providerPlaceId: string | null;
  /** Null whenever the place was typed rather than searched. */
  coordinates: Coordinates | null;
  locale: Locale;
  /**
   * Opt-in, per place. Nothing reaches a calendar entry without it.
   *
   * It governs the *device calendar*, not storage. The venue's label is written
   * to `plans.location` either way, because that is what the plan is — and
   * because a flag flipped on later would otherwise have nothing to show. What
   * the opt-in decides is whether the address leaves this app for the OS,
   * where a shared Mac or a family calendar can see it. `plan_busy_times`
   * selects three columns and `location` is not one of them, so nothing crosses
   * to the other app in either case.
   */
  shareWithCalendar: boolean;
  /** Null once the person who attached it deletes their account. */
  attachedBy: string | null;
  createdAt: string;
}

/**
 * A span between two instants.
 *
 * Declared once, here, because three layers pass it to each other: the device
 * reads free/busy off the phone's calendar, the cadence engine merges and
 * subtracts those spans to find an opening, and both apps hand the result
 * between the two. It used to be declared separately in each of the three,
 * identically — so the values flowed across the boundaries and typechecked by
 * coincidence rather than by agreement.
 */
export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * A window the couple is occupied in, and nothing more.
 *
 * The same two instants, named for what they mean when they come from the
 * server: no title, no domain and no author — not because those are stripped
 * on the way out, but because the `plan_busy_times` view never selects them.
 * Both apps consume this to stop offering a time that is already spoken for,
 * and neither can learn what is occupying it.
 */
export type BusyWindow = TimeRange;

export interface Checkin {
  id: string;
  coupleId: string;
  profileId: string;
  /** Calendar date in the couple's timezone, `YYYY-MM-DD`. */
  onDate: string;
  interest: CheckinInterest;
  /** Partner-authored, shown verbatim and never machine-translated. */
  note: string | null;
  createdAt: string;
}
