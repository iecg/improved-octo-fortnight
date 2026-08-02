/**
 * Guards the bilingual promise at the file level.
 *
 * Both partners read the same rows in different languages, so a key that
 * exists in `en` but not `es` is not a cosmetic bug — it is one partner
 * seeing raw dot-notation where a sentence should be. This walks every
 * `locales/` directory in the workspace so app-specific namespaces are covered
 * automatically, with nothing to register.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REQUIRED_LOCALES = ['en', 'es'] as const;
/**
 * `.claude` holds git worktrees. Without it here, a run from the main checkout
 * walks into every worktree and tests their locale files too — inflating the
 * count, and failing `main`'s suite over a half-finished translation in an
 * unrelated branch.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.claude',
  '.expo',
  'dist',
  'ios',
  'android',
]);

/** Every directory named `locales` anywhere in the workspace. */
function findLocaleDirs(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry === 'locales') found.push(full);
    else findLocaleDirs(full, found);
  }
  return found;
}

/** `{ a: { b: 'x' } }` -> `['a.b']`, with the leaf value alongside. */
function flatten(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [[prefix, value]];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholdersIn(value: unknown): Set<string> {
  if (typeof value !== 'string') return new Set();
  return new Set(Array.from(value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), (m) => m[1] as string));
}

function readNamespace(localeDir: string, locale: string, file: string): unknown {
  return JSON.parse(readFileSync(join(localeDir, locale, file), 'utf8'));
}

function namespaceFilesIn(localeDir: string, locale: string): string[] {
  return readdirSync(join(localeDir, locale))
    .filter((name) => name.endsWith('.json'))
    .sort();
}

const localeDirs = findLocaleDirs(REPO_ROOT);

describe('locale files', () => {
  it('finds at least one locale directory', () => {
    expect(localeDirs.length).toBeGreaterThan(0);
  });

  for (const localeDir of localeDirs) {
    const label = relative(REPO_ROOT, localeDir);

    describe(label, () => {
      it('ships every required language', () => {
        const present = readdirSync(localeDir).filter((entry) =>
          statSync(join(localeDir, entry)).isDirectory(),
        );
        for (const locale of REQUIRED_LOCALES) {
          expect(present, `${label} is missing the "${locale}" directory`).toContain(locale);
        }
      });

      it('ships the same namespaces in every language', () => {
        const [reference, ...rest] = REQUIRED_LOCALES;
        const expected = namespaceFilesIn(localeDir, reference);
        for (const locale of rest) {
          expect(namespaceFilesIn(localeDir, locale)).toEqual(expected);
        }
      });

      for (const file of namespaceFilesIn(localeDir, 'en')) {
        describe(file, () => {
          const en = flatten(readNamespace(localeDir, 'en', file));
          const enKeys = en.map(([key]) => key);

          it('has identical keys in every language', () => {
            for (const locale of REQUIRED_LOCALES.filter((l) => l !== 'en')) {
              const otherKeys = flatten(readNamespace(localeDir, locale, file)).map(([key]) => key);

              const missing = enKeys.filter((key) => !otherKeys.includes(key));
              const extra = otherKeys.filter((key) => !enKeys.includes(key));

              expect(missing, `${locale}/${file} is missing keys`).toEqual([]);
              expect(extra, `${locale}/${file} has keys absent from en`).toEqual([]);
            }
          });

          it('keeps plural forms complete', () => {
            for (const locale of REQUIRED_LOCALES) {
              const keys = flatten(readNamespace(localeDir, locale, file)).map(([k]) => k);
              // English and Spanish both use the one/other pair. A key with a
              // `_one` variant and no `_other` renders as the raw key for every
              // count but 1.
              for (const key of keys.filter((k) => k.endsWith('_one'))) {
                const other = `${key.slice(0, -'_one'.length)}_other`;
                expect(keys, `${locale}/${file}: ${key} has no ${other}`).toContain(other);
              }
              for (const key of keys.filter((k) => k.endsWith('_other'))) {
                const one = `${key.slice(0, -'_other'.length)}_one`;
                expect(keys, `${locale}/${file}: ${key} has no ${one}`).toContain(one);
              }
            }
          });

          it('uses the same interpolation placeholders in every language', () => {
            for (const locale of REQUIRED_LOCALES.filter((l) => l !== 'en')) {
              const other = new Map(flatten(readNamespace(localeDir, locale, file)));

              for (const [key, enValue] of en) {
                const expected = placeholdersIn(enValue);
                const actual = placeholdersIn(other.get(key));
                expect(
                  [...actual].sort(),
                  `${locale}/${file}: ${key} placeholders drifted from en`,
                ).toEqual([...expected].sort());
              }
            }
          });

          it('has no blank strings', () => {
            for (const locale of REQUIRED_LOCALES) {
              for (const [key, value] of flatten(readNamespace(localeDir, locale, file))) {
                expect(typeof value, `${locale}/${file}: ${key} is not a string`).toBe('string');
                expect(String(value).trim(), `${locale}/${file}: ${key} is blank`).not.toBe('');
              }
            }
          });
        });
      }
    });
  }
});
