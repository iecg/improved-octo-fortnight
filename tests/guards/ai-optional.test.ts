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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { libraryFor } from '../../apps/two-two-two/src/ideas';
import en from '../../apps/two-two-two/src/locales/en/ideas.json';
import es from '../../apps/two-two-two/src/locales/es/ideas.json';
import { TWO_TWO_TWO_KINDS } from '../../packages/core/src/kinds';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCANNED = ['apps', 'packages', 'supabase'];
const IGNORED_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'ios', 'android']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Anything that only makes sense when a model is reachable. Deliberately
 * includes the env var itself: reading it outside the AI feature is the exact
 * shape of "assumes a model exists".
 */
const MODEL_MARKERS = [/ANTHROPIC_API_KEY/, /@anthropic-ai\//, /\bnew\s+Anthropic\b/];

/** The one place any of this is allowed to live. */
function isAiFeaturePath(relativePath: string): boolean {
  const parts = relativePath.split(sep);
  const features = parts.indexOf('features');
  // .../features/<name>/ai/...
  return features !== -1 && parts[features + 2] === 'ai';
}

function sourceFilesIn(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFilesIn(full, found);
    else if (SOURCE_EXTENSIONS.has(extname(entry))) found.push(full);
  }
  return found;
}

const files = SCANNED.flatMap((dir) => {
  const full = join(REPO_ROOT, dir);
  return statSync(full).isDirectory() ? sourceFilesIn(full) : [];
});

describe('the AI-optional rule', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('keeps every assumption that a model exists inside features/*/ai/', () => {
    const offenders = files
      .filter((file) => !isAiFeaturePath(relative(REPO_ROOT, file)))
      .filter((file) => {
        const contents = readFileSync(file, 'utf8');
        return MODEL_MARKERS.some((marker) => marker.test(contents));
      })
      .map((file) => relative(REPO_ROOT, file));

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
