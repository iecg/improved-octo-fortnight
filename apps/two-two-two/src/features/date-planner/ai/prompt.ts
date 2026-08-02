/**
 * The prompt, and the boundary of what leaves the device.
 *
 * This is the only module that decides what is sent to a third party, which is
 * why it takes a small explicit record rather than anything resembling a
 * session, a plan, or a repository. What goes out: which of the three
 * commitments this is, which language to answer in, how many ideas, and three
 * optional free-text fields the user filled in this session — where they are
 * planning to be, what they want to spend, and anything else to steer it.
 *
 * Never: the couple's id, either profile id, display names, the invite code,
 * the anniversary, any plan (title, date, time, location, notes, calendar
 * ids), any check-in, the shortlist, or any Supabase token. Nothing from the
 * intimacy domain can reach this function: the app it lives in has no accessor
 * for those rows at all.
 *
 * The couple's timezone stays on that list even though a location now leaves.
 * Those are not the same thing. A city typed into a labelled field is chosen,
 * checked and as coarse as the user wants it; a timezone is inferred from a
 * device setting, never reviewed, and says where someone *is* rather than where
 * they are planning to go. The user naming the place themselves is what makes
 * sending it fine, and it is also why the inferred proxy is still not needed.
 *
 * The strings below are machine-facing instructions, not chrome. They are the
 * one place in the app where English is not a bug: the model is being told what
 * to do, and it is told to *answer* in the reader's language.
 */
import type { Locale } from '@couple/core';

export interface SuggestionRequest {
  /** A 2-2-2 kind token: `date_night`, `getaway`, `trip`. Opaque elsewhere. */
  kind: string;
  /** The requesting partner's language. The model answers in this. */
  locale: Locale;
  /** How many ideas to ask for. */
  count: number;
  /**
   * Where they are planning to be — usually a city, and as coarse as they
   * choose to make it. Free text the user typed this session, never persisted.
   */
  location?: string;
  /**
   * What they want to spend. Free text rather than a number and a currency,
   * because "cheap", "under £50" and "money is not the point" are all things
   * people actually mean.
   */
  budget?: string;
  /** Anything else to steer it. Same lifetime as the two above. */
  hint?: string;
}

export interface PromptParts {
  system: string;
  user: string;
  /** JSON schema, handed to whichever provider can enforce it. */
  schema: Readonly<Record<string, unknown>>;
}

/**
 * Neutral descriptions of the three commitments.
 *
 * The engine treats `kind` as opaque and adding one is a constant plus two
 * translation keys, so an unknown kind falls back rather than throwing — a new
 * ritual should degrade to a generic prompt, not break the feature.
 */
const KIND_BRIEFS: Record<string, string> = {
  date_night: 'an evening out together, a few hours long',
  getaway: 'a short trip of one to three nights, somewhere reachable without flying far',
  trip: 'a longer holiday of a week or more, somewhere worth travelling for',
};

const FALLBACK_BRIEF = 'time spent together as a couple';

const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Spanish',
};

/** Mirrors the `plan_ideas` check constraints, so nothing we accept can be rejected. */
export const TITLE_MAX = 200;
export const SUMMARY_MAX = 2000;

export const IDEA_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          estCostBand: { type: 'string', enum: ['free', 'low', 'medium', 'high'] },
        },
        required: ['title', 'summary', 'estCostBand'],
      },
    },
  },
  required: ['ideas'],
};

export function briefFor(kind: string): string {
  return KIND_BRIEFS[kind] ?? FALLBACK_BRIEF;
}

/** `Label: value`, or nothing at all when the user left the field alone. */
function optionalLine(label: string, value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

export function buildPrompt(request: SuggestionRequest): PromptParts {
  const language = LANGUAGE_NAMES[request.locale];

  const system = [
    'You suggest things a couple could do together.',
    `Reply in ${language}. Write every title and summary in ${language}.`,
    'Reply with JSON only, matching the requested schema. No prose, no code fences.',
    `Each title is at most ${TITLE_MAX} characters and each summary at most ${SUMMARY_MAX}.`,
    'A summary is one or two sentences saying what the plan actually involves.',
    'estCostBand is one of: free, low, medium, high.',
    'Do not include links or URLs.',
    'Suggest things that are specific enough to act on, and varied.',
  ].join(' ');

  // Each field is passed through verbatim and omitted entirely when blank.
  // Verbatim because these are the user's own words, and rewriting them here
  // would make this a second place that decides what is sent; omitted because
  // an empty line is worse than no line — "Budget:" with nothing after it
  // reads to a model as a constraint rather than an absence.
  const lines = [
    `Suggest ${request.count} ideas for ${briefFor(request.kind)}.`,
    optionalLine('Near', request.location),
    optionalLine('Budget', request.budget),
    optionalLine('Take this into account', request.hint),
  ].filter((line): line is string => line !== null);

  return { system, user: lines.join('\n'), schema: IDEA_SCHEMA };
}
