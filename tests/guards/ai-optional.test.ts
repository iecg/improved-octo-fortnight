/**
 * The 2-2-2 app's AI-optional rule, enforced rather than remembered.
 *
 * The rule: no path outside `features/<name>/ai/` may assume a model exists, and
 * the suite must pass with `ANTHROPIC_API_KEY` unset. The curated library and
 * manual entry are what make the ideas feature work with no key configured;
 * `ai_usage` simply stays empty.
 *
 * This is a grep with a reason attached. It is cheap, and it is the kind of
 * rule that quietly stops being true the first time someone adds a convenient
 * import at the top of a screen.
 *
 * The rule is the 2-2-2 app's alone — the intimacy app has no AI story at all,
 * which is why the whole repo is scanned rather than just that app.
 */
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { libraryFor } from '../../apps/two-two-two/src/ideas';
import en from '../../apps/two-two-two/src/locales/en/ideas.json';
import es from '../../apps/two-two-two/src/locales/es/ideas.json';
import { TWO_TWO_TWO_KINDS } from '../../packages/core/src/kinds';
import { isFeatureSegmentPath, REPO_ROOT, scannedFiles } from './sources';

/**
 * Anything that only makes sense when a model is reachable. Deliberately
 * includes the env var itself: reading it outside the AI feature is the exact
 * shape of "assumes a model exists".
 */
const MODEL_MARKERS = [/ANTHROPIC_API_KEY/, /@anthropic-ai\//, /\bnew\s+Anthropic\b/];

/**
 * The server half.
 *
 * `SCANNED` includes `supabase/`, so the planned `suggest-ideas` function would
 * have tripped this rule the moment it was written — and it is precisely where
 * a key *should* live, since an Edge Function secret never reaches a phone.
 * The client half of the rule is unchanged: nothing under `apps/` may assume a
 * model exists outside its own feature folder.
 */
function isEdgeFunctionPath(relativePath: string): boolean {
  return relativePath.startsWith(join('supabase', 'functions') + sep);
}

const files = scannedFiles();

describe('the AI-optional rule', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('keeps every assumption that a model exists inside features/*/ai/', () => {
    const offenders = files
      .map((file) => relative(REPO_ROOT, file))
      .filter((path) => !isFeatureSegmentPath(path, 'ai') && !isEdgeFunctionPath(path))
      .filter((path) => {
        const contents = readFileSync(join(REPO_ROOT, path), 'utf8');
        return MODEL_MARKERS.some((marker) => marker.test(contents));
      });

    expect(offenders).toEqual([]);
  });

  /**
   * The rule is only worth anything if the no-model path is actually useful.
   * An empty library would satisfy the grep above and leave the ideas screen
   * blank for anyone without a key — which is everyone, today.
   */
  it('ships a usable library for every kind, with no model involved', () => {
    for (const definition of Object.values(TWO_TWO_TWO_KINDS)) {
      const ids = libraryFor(definition.kind);
      expect(ids.length, `${definition.kind} has no bundled ideas`).toBeGreaterThanOrEqual(5);
      expect(new Set(ids).size, `${definition.kind} has duplicate ids`).toBe(ids.length);

      // Every id resolves to real text in both languages — a missing entry
      // would render as raw dot-notation on someone's screen.
      for (const id of ids) {
        for (const locale of ['en', 'es'] as const) {
          const bundle = locale === 'en' ? en : es;
          const idea = (bundle as Record<string, Record<string, { title?: string }>>)[
            definition.kind
          ]?.[id];
          expect(idea?.title, `${locale}/${definition.kind}.${id}.title is missing`).toBeTruthy();
        }
      }
    }
  });
});
