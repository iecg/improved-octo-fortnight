/**
 * Every key the code asks for exists in the bundles.
 *
 * `tests/i18n/parity.test.ts` guards the other direction — that `en` and `es`
 * agree with each other — and cannot see this one at all. A key absent from
 * *both* languages is perfectly at parity, so parity stays green while the
 * screen renders raw dot-notation. That is not hypothetical: `common:action.next`
 * shipped on the pairing screen, and `common:state.error` was the only message
 * on nine catch paths through device approval and recovery. All four missing
 * keys were found on a simulator, by reading a button that said `action.next`.
 *
 * A grep with a reason attached, in the same spirit as `./ai-optional.test.ts`.
 * It cannot be a behaviour test: rendering every screen in both languages and
 * asserting no label looks like a key is more machinery than the rule deserves,
 * and it would still miss the eight error paths nothing routinely reaches.
 *
 * ## Why quoted literals only
 *
 * Every dynamic key in this repo is a backtick template; every static one is
 * quoted. Restricting the scan to `'` and `"` therefore skips the dynamic ones
 * structurally rather than by allowlist, and there is no false positive to
 * exempt. Scanning literals *anywhere* rather than only inside `t(` is what
 * catches `errorKey: 'common:state.error'`, whose consumer is `t(errorKey)` and
 * whose key never appears next to a `t(`.
 *
 * Part B covers what that cannot see, by importing the real key builders and
 * asking them what they produce.
 *
 * ## Known holes, deliberately
 *
 *   * **Unprefixed keys.** Files using the string form `useTranslation('app')`
 *     write `t('tabs.today')`. Thirteen sites, all resolving today. Covering
 *     them needs per-hook namespace inference, and `AiSuggestionCard.tsx`
 *     already has two hooks with different namespaces in one file. Add it when
 *     it bites.
 *   * A *static* backtick key would escape the regex. None exists.
 *   * Whether a plural-only key is called with `count` is a call-site question
 *     this cannot answer.
 */
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { healthLabelKey } from '../../packages/cadence/src/engine';
import {
  CHECKIN_INTERESTS,
  INTERVAL_UNITS,
  LOCALES,
  PLAN_STATUSES,
} from '../../packages/core/src/domain';
import {
  INTIMACY_KINDS,
  TWO_TWO_TWO_KINDS,
  kindDescriptionKey,
  kindLabelKey,
} from '../../packages/core/src/kinds';
import { JOIN_FAILURES } from '../../packages/data/src/accounts';
// Not `@couple/i18n`: its barrel pulls i18next and react-i18next in at module
// scope, and this suite runs under plain Node.
import { dueTranslation, intervalTranslation } from '../../packages/i18n/src/format';
import { ideaSummaryKey, libraryFor } from '../../apps/two-two-two/src/ideas';
import {
  AI_PROVIDER_IDS,
  providerLabelKey,
} from '../../apps/two-two-two/src/features/date-planner/ai/providers';
import { driveTimeLabel } from '../../apps/two-two-two/src/features/places/travel';

import { REPO_ROOT, scannedFiles } from './sources';

const REQUIRED_LOCALES = ['en', 'es'] as const;

/**
 * Where each namespace's bundle lives. Four roots, not three — `ai` ships
 * beside the feature that owns it rather than with the app's other namespaces.
 *
 * `app` is deliberately absent: both apps register a namespace by that name
 * with different contents, so it resolves against the app owning the file.
 */
const SHARED = 'packages/i18n/src/locales';
const TWO22 = 'apps/two-two-two/src/locales';
const NAMESPACE_DIRS: Record<string, string> = {
  common: SHARED,
  cadence: SHARED,
  plans: SHARED,
  auth: SHARED,
  ideas: TWO22,
  places: TWO22,
  ai: 'apps/two-two-two/src/features/date-planner/ai/locales',
};

const APP_DIRS: Record<string, string> = {
  'apps/intimacy': 'apps/intimacy/src/locales',
  'apps/two-two-two': TWO22,
};

const NAMESPACES = [...Object.keys(NAMESPACE_DIRS), 'app'];

/** Quoted, never backticked — see the docblock. */
const KEY_PATTERN = new RegExp(`['"]((?:${NAMESPACES.join('|')}):[A-Za-z0-9_.]+)['"]`, 'g');

/** `{ a: { b: 'x' } }` -> `['a.b']`. Copied from `tests/i18n/parity.test.ts`
 *  rather than imported: that file is a suite, and importing it would run the
 *  whole parity suite again nested inside this one. */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const bundles = new Map<string, Set<string>>();

/** The flattened key set for one namespace in one language. */
function keysOf(localeDir: string, locale: string, namespace: string): Set<string> {
  const cacheKey = `${localeDir}|${locale}|${namespace}`;
  const cached = bundles.get(cacheKey);
  if (cached) return cached;

  const path = join(REPO_ROOT, localeDir, locale, `${namespace}.json`);
  const keys = new Set(flatten(JSON.parse(readFileSync(path, 'utf8')) as unknown));
  bundles.set(cacheKey, keys);
  return keys;
}

/**
 * A key resolves if it is there, or if it is a complete plural pair.
 *
 * Both halves, not either: `foo_one` alone renders as the raw key for every
 * count but one. `cadence:due.in`, `cadence:interval.every_*` and
 * `places:travel.{minutes,hours}` exist only in this form, so the fallback is
 * load-bearing rather than defensive.
 */
function resolves(keys: Set<string>, path: string): boolean {
  return keys.has(path) || (keys.has(`${path}_one`) && keys.has(`${path}_other`));
}

/** The locale directory a namespace resolves against, for a file at `relPath`. */
function localeDirFor(namespace: string, relPath: string): string | null {
  if (namespace !== 'app') return NAMESPACE_DIRS[namespace] ?? null;
  const owner = Object.keys(APP_DIRS).find((app) => relPath.startsWith(`${app}${sep}`));
  return owner ? (APP_DIRS[owner] as string) : null;
}

interface Reference {
  relPath: string;
  line: number;
  namespace: string;
  path: string;
}

const references: Reference[] = (() => {
  const found: Reference[] = [];
  for (const file of scannedFiles()) {
    const relPath = relative(REPO_ROOT, file);
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(KEY_PATTERN)) {
      const full = match[1] as string;
      const [namespace, ...rest] = full.split(':');
      found.push({
        relPath,
        line: contents.slice(0, match.index).split('\n').length,
        namespace: namespace as string,
        path: rest.join(':'),
      });
    }
  }
  return found;
})();

describe('translation keys referenced in code', () => {
  // Two canaries. A file count alone would still pass if the regex quietly
  // stopped matching anything.
  it('has source files to check', () => {
    expect(scannedFiles().length).toBeGreaterThan(0);
  });

  it('finds keys to resolve', () => {
    expect(references.length).toBeGreaterThan(300);
  });

  it('only uses app namespaces from inside an app', () => {
    // `app`, `ideas`, `places` and `ai` are registered per app at runtime, so a
    // shared package reaching for one would resolve to nothing in the other app.
    const offenders = references
      .filter(
        ({ namespace }) =>
          namespace === 'app' || NAMESPACE_DIRS[namespace] === TWO22 || namespace === 'ai',
      )
      .filter(({ relPath }) => !relPath.startsWith(`apps${sep}`))
      .map(({ relPath, line, namespace, path }) => `${relPath}:${line} ${namespace}:${path}`);

    expect(offenders).toEqual([]);
  });

  it('resolves every key in every language', () => {
    const offenders: string[] = [];

    for (const { relPath, line, namespace, path } of references) {
      const localeDir = localeDirFor(namespace, relPath);
      if (localeDir === null) {
        offenders.push(`${relPath}:${line} ${namespace}:${path} (no bundle for namespace)`);
        continue;
      }
      for (const locale of REQUIRED_LOCALES) {
        if (!resolves(keysOf(localeDir, locale, namespace), path)) {
          offenders.push(`${relPath}:${line} ${namespace}:${path} (${locale})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * The keys no grep can see, asked of the code that builds them.
 *
 * Importing the real builders rather than restating their patterns is the point:
 * a pattern written out here would drift from the one that ships, and the guard
 * would go on passing. `ai:error.*` and `ideas:*.title` are absent because
 * `ai/errors.test.ts` and `./ai-optional.test.ts` already cover them.
 */
const intimacyKinds = Object.keys(INTIMACY_KINDS);
const two22Kinds = Object.keys(TWO_TWO_TWO_KINDS);

/** Inline unions with no runtime array. Tied to their types so a rename here
 *  is a typecheck failure rather than a silently shorter list. */
const CADENCE_HEALTHS = ['on_track', 'due_soon', 'overdue'] as const;
const WRAP_FAILURES = ['key_changed', 'gone'] as const;
const RECOVERY_FAILURES = ['no_envelope', 'bad_code'] as const;

const BUILT: Array<{ label: string; keys: string[] }> = [
  {
    label: 'kind labels and descriptions',
    keys: [
      ...intimacyKinds.flatMap((kind) => [
        kindLabelKey('intimacy', kind),
        kindDescriptionKey('intimacy', kind),
      ]),
      ...two22Kinds.flatMap((kind) => [
        kindLabelKey('two_two_two', kind),
        kindDescriptionKey('two_two_two', kind),
      ]),
    ],
  },
  { label: 'cadence health', keys: CADENCE_HEALTHS.map((h) => healthLabelKey(h)) },
  {
    label: 'due wording',
    // -3 overdue, 0 today, 1 tomorrow, 5 in-n-days: every branch of the function.
    keys: [-3, 0, 1, 5].map((days) => dueTranslation(days).key),
  },
  {
    label: 'interval wording',
    keys: INTERVAL_UNITS.map((unit) => intervalTranslation(2, unit).key),
  },
  { label: 'drive time', keys: [null, 30, 150].map((m) => driveTimeLabel(m).key) },
  { label: 'ai providers', keys: AI_PROVIDER_IDS.map((id) => providerLabelKey(id)) },
  {
    label: 'idea summaries',
    // Keyed by 2-2-2 kinds; `libraryFor` yields nothing for anything else.
    keys: two22Kinds.flatMap((kind) => libraryFor(kind).map((id) => ideaSummaryKey(kind, id))),
  },
  { label: 'plan statuses', keys: PLAN_STATUSES.map((s) => `plans:status.${s}`) },
  { label: 'languages', keys: LOCALES.map((l) => `common:language.${l}`) },
  { label: 'checkin interests', keys: CHECKIN_INTERESTS.map((i) => `app:checkin.${i}`) },
  { label: 'join failures', keys: JOIN_FAILURES.map((r) => `auth:pair.error.${r}`) },
  {
    label: 'wrap failures',
    keys: WRAP_FAILURES.map((r) => `auth:keys.approve.error.${r}`),
  },
  {
    label: 'recovery failures',
    keys: RECOVERY_FAILURES.map((r) => `auth:keys.recovery.code.error.${r}`),
  },
];

describe('translation keys built at runtime', () => {
  it('has families to check', () => {
    expect(BUILT.flatMap(({ keys }) => keys).length).toBeGreaterThan(0);
  });

  for (const { label, keys } of BUILT) {
    it(`resolves ${label}`, () => {
      const offenders: string[] = [];

      for (const full of keys) {
        const [namespace, ...rest] = full.split(':');
        const path = rest.join(':');
        // `app:` here means the app that owns the family; checkin is intimacy's.
        const localeDir =
          namespace === 'app'
            ? (APP_DIRS['apps/intimacy'] as string)
            : (NAMESPACE_DIRS[namespace as string] as string);

        for (const locale of REQUIRED_LOCALES) {
          if (!resolves(keysOf(localeDir, locale, namespace as string), path)) {
            offenders.push(`${full} (${locale})`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});
