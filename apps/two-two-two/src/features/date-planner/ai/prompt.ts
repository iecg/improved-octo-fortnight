/**
 * The prompt, and the boundary of what leaves the device.
 *
 * This is the only module that decides what is sent to a third party, which is
 * why it takes a small explicit record rather than anything resembling a
 * session, a plan, or a repository. Four things go out: which of the three
 * commitments this is, which language to answer in, how many ideas, and an
 * optional hint the user typed in this session.
 *
 * Never: the couple's id, either profile id, display names, the invite code,
 * the anniversary, any plan (title, date, time, location, notes, calendar
 * ids), any check-in, the shortlist, the couple's timezone — a timezone is a
 * location proxy and nothing here needs one — or any Supabase token. Nothing
 * from the intimacy domain can reach this function: the app it lives in has no
 * accessor for those rows at all.
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
  /** Free text the user typed this session. Ephemeral, never persisted. */
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

  const lines = [
    `Suggest ${request.count} ideas for ${briefFor(request.kind)}.`,
    // Passed through verbatim: this is the user's own sentence, and rewriting
    // it here would be a second place that decides what is sent.
    request.hint?.trim() ? `Take this into account: ${request.hint.trim()}` : null,
  ].filter((line): line is string => line !== null);

  return { system, user: lines.join('\n'), schema: IDEA_SCHEMA };
}
