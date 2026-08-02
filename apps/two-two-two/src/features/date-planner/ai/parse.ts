/**
 * Turning whatever the model said into rows the database will accept.
 *
 * Both providers are asked for JSON natively, and both usually oblige — but
 * "usually" is the operative word. Models wrap JSON in ``` fences, prefix it
 * with "Here are some ideas:", or return a bare array when asked for an
 * object. Tolerating that is not defensive clutter, it is the actual behaviour.
 *
 * The validation bounds are not arbitrary. `plan_ideas` carries
 * `length(title) between 1 and 200`, `length(summary) <= 2000` and
 * `est_cost_band in ('free','low','medium','high')`, and
 * `createIdeaRepository.save` rethrows the raw Postgres message on violation —
 * which would put untranslated English in front of whichever partner does not
 * read it. Anything that would not survive the insert is fixed or dropped here.
 */
import { COST_BANDS, type CostBand } from '@couple/core';

import { AiError } from './errors';
import { SUMMARY_MAX, TITLE_MAX } from './prompt';

export interface SuggestedIdea {
  /** 1..200 characters, already trimmed. */
  title: string;
  summary: string | null;
  estCostBand: CostBand | null;
}

/** Strip a leading ```json fence and its closing counterpart, if present. */
function stripFences(text: string): string {
  const fenced = /^\s*```(?:[a-zA-Z]+)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text.trim());
  return fenced?.[1] ?? text;
}

/**
 * The first balanced `{...}` or `[...]` in the text.
 *
 * Scans rather than regexing so a brace inside a string value cannot end the
 * match early — a summary containing "{" is entirely plausible.
 */
function firstJsonBlock(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function parseJson(text: string): unknown {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to the scan: the model may have wrapped the JSON in prose.
  }

  const block = firstJsonBlock(cleaned);
  if (block === null) throw new AiError('malformed');
  try {
    return JSON.parse(block);
  } catch (cause) {
    throw new AiError('malformed', { cause });
  }
}

/** Accepts `{ ideas: [...] }`, `{ suggestions: [...] }` or a bare array. */
function entriesOf(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    for (const key of ['ideas', 'suggestions', 'results']) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
  }
  throw new AiError('malformed');
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Truncate on a word boundary where one is close enough to the limit. */
function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function readCostBand(value: unknown): CostBand | null {
  if (typeof value !== 'string') return null;
  const normalised = value.trim().toLowerCase();
  return COST_BANDS.includes(normalised as CostBand) ? (normalised as CostBand) : null;
}

/**
 * Validated ideas, in the model's order, deduped and capped.
 *
 * Returns an empty array when nothing survives rather than throwing — the
 * caller distinguishes "could not read the reply" (`malformed`) from "read it
 * fine, there was nothing in it" (`empty`), and those are different sentences.
 */
export function extractIdeas(contentText: string, max: number): SuggestedIdea[] {
  const entries = entriesOf(parseJson(contentText));

  const ideas: SuggestedIdea[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (ideas.length >= max) break;
    if (typeof entry !== 'object' || entry === null) continue;

    const record = entry as Record<string, unknown>;
    const rawTitle = readString(record.title);
    if (rawTitle === null) continue;

    const title = clamp(rawTitle, TITLE_MAX);
    const fingerprint = title.toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const rawSummary = readString(record.summary);

    ideas.push({
      title,
      summary: rawSummary === null ? null : clamp(rawSummary, SUMMARY_MAX),
      estCostBand: readCostBand(record.estCostBand ?? record.est_cost_band),
    });
  }

  return ideas;
}
