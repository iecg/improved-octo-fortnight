/**
 * Invariant 5: the cadence engine is pure.
 *
 * No I/O, no React, no i18n, no `new Date()` — it returns structured data and
 * translation keys, and all date arithmetic goes through the couple's timezone.
 *
 * CLAUDE.md cites `packages/cadence/src/*.test.ts` as the backing for this, and
 * those are fifty-odd good tests — of *behaviour*. None of them asserts the
 * structural rule, and behaviour tests cannot: an engine that read the system
 * clock would pass every one of them on the machine that wrote them, and start
 * failing at a timezone boundary on someone else's.
 *
 * The only thing standing between that and here is the `TZ: 'Pacific/Auckland'`
 * pin in `vitest.config.ts`, which turns a dropped `timeZone` argument into a
 * failure rather than a coincidence. That pin is a good backstop and not a
 * rule — it catches a bug that already happened, on the tests that happen to
 * cover it.
 *
 * This is the rule itself, as a grep, in the same spirit as
 * `./ai-optional.test.ts`. It is the cheapest of the guards and guards the
 * invariant with the widest blast radius: everything downstream — both apps'
 * countdowns, the free-window search, the calendar reconciliation — assumes it
 * can call these functions anywhere and get the same answer twice.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINE = fileURLToPath(new URL('../../packages/cadence/src', import.meta.url));

/** Source files only: the tests may do as they like. */
function engineSources(): string[] {
  return readdirSync(ENGINE)
    .filter((entry) => extname(entry) === '.ts' && !entry.endsWith('.test.ts'))
    .map((entry) => join(ENGINE, entry));
}

/**
 * Comments are where this rule gets *explained*, so a naive grep would trip
 * over the prose describing it. Strip them first.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Everything a pure engine has no business importing. */
const FORBIDDEN_IMPORTS = [
  /^react/,
  /^react-native/,
  /^i18next/,
  /^@couple\/(data|device|i18n|ui)$/,
  /^node:/,
  /^@supabase\//,
];

/** The one dependency it may have, plus the date library it is built on. */
const ALLOWED_IMPORTS = [/^@couple\/core$/, /^date-fns/, /^\.\.?\//];

function importsOf(contents: string): string[] {
  return [...contents.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

describe('invariant 5: the cadence engine is pure', () => {
  it('has sources to check', () => {
    expect(engineSources().length).toBeGreaterThan(0);
  });

  it('never reads the clock', () => {
    // `now` is always an argument. A single `new Date()` here would make every
    // downstream countdown depend on when it happened to be called.
    for (const file of engineSources()) {
      const contents = code(file);
      expect(contents, `${file}: new Date() with no argument`).not.toMatch(/new Date\(\s*\)/);
      expect(contents, `${file}: Date.now()`).not.toMatch(/\bDate\.now\s*\(/);
    }
  });

  it('imports nothing that could do I/O, render, or translate', () => {
    for (const file of engineSources()) {
      for (const specifier of importsOf(code(file))) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(forbidden.test(specifier), `${file} imports ${specifier}`).toBe(false);
        }
        expect(
          ALLOWED_IMPORTS.some((allowed) => allowed.test(specifier)),
          `${file} imports ${specifier}, which is not on the allowed list`,
        ).toBe(true);
      }
    }
  });

  it('returns translation keys rather than display strings', () => {
    // The engine names keys; it never renders one. A `t(` here would mean the
    // engine had opinions about a language, and the two partners read in
    // different ones off the same rows.
    for (const file of engineSources()) {
      expect(code(file), `${file}: calls a translator`).not.toMatch(/\bt\(['"`]/);
    }
  });
});
