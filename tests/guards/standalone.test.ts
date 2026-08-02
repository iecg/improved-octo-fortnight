/**
 * The two apps integrate, and neither depends on the other.
 *
 * There is one account and one pairing across both apps, so it is tempting to
 * treat them as one product with two front doors. They are not. Each is
 * installed on its own, and the rule that keeps that honest is:
 *
 *   **integration only ever removes friction; it never unlocks a feature.**
 *
 * Nothing may be gated on the other app being installed, on the other app's
 * rows being readable, or on the device calendar carrying the other app's
 * events. The cross-app conveniences — marking a time that is already taken —
 * degrade to nothing and leave a working screen behind.
 *
 * Like `./ai-optional.test.ts`, this is a grep with a reason attached. It is
 * cheap, and these are exactly the rules that quietly stop being true the
 * first time someone adds a convenient import at the top of a screen.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IGNORED_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'ios', 'android']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const APPS = {
  intimacy: join(REPO_ROOT, 'apps/intimacy'),
  two_two_two: join(REPO_ROOT, 'apps/two-two-two'),
} as const;

function sourceFilesIn(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFilesIn(full, found);
    else if (SOURCE_EXTENSIONS.has(extname(entry))) found.push(full);
  }
  return found;
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Every module a file actually pulls in — `import … from` and `require(…)`. */
function importSpecifiers(contents: string): string[] {
  const specs: string[] = [];
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) specs.push(match[1]!);
  }
  return specs;
}

const filesByApp = {
  intimacy: sourceFilesIn(APPS.intimacy),
  two_two_two: sourceFilesIn(APPS.two_two_two),
};

const allAppFiles = [...filesByApp.intimacy, ...filesByApp.two_two_two];

describe('each app stands alone', () => {
  it('has source files to check', () => {
    expect(filesByApp.intimacy.length).toBeGreaterThan(0);
    expect(filesByApp.two_two_two.length).toBeGreaterThan(0);
  });

  /**
   * The blunt version of the rule. Sharing happens through `packages/*`, which
   * is reviewable; a direct reach across `apps/` is not.
   *
   * Import specifiers only, not the whole file — the two apps' modules refer to
   * each other in prose all the time, deliberately, because being deliberately
   * parallel is the point of them. A comment is not a dependency.
   */
  it.each([
    ['intimacy', 'two_two_two', 'two-two-two'],
    ['two_two_two', 'intimacy', 'intimacy'],
  ] as const)('does not let %s import from %s', (app, _other, segment) => {
    const offenders = filesByApp[app]
      .filter((file) => importSpecifiers(read(file)).some((spec) => spec.includes(segment)))
      .map((file) => relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });

  /**
   * The domain boundary, from the app side. `packages/data`'s own test guards
   * the shape of the factories; this guards who calls them. Check-ins are
   * intimacy-owned and ideas are 2-2-2-owned, and each app should have nothing
   * to import from the other even by accident.
   */
  it.each([
    ['intimacy', 'createIdeaRepository'],
    ['two_two_two', 'createCheckinRepository'],
  ] as const)('does not let %s reach the other app’s repository (%s)', (app, factory) => {
    const offenders = filesByApp[app]
      .filter((file) => read(file).includes(factory))
      .map((file) => relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});

describe('the domain boundary holds at the realtime layer', () => {
  /**
   * RLS cannot hide one app's plans from the other — both partners are
   * legitimate members of the couple — so an unfiltered `postgres_changes`
   * subscription on `plans` delivers the other app's rows, notes and all,
   * into a socket that has no business seeing them. Discarding the payload in
   * the callback is not the same as never receiving it.
   */
  it('filters every plans subscription', () => {
    const subscribers = allAppFiles.filter((file) => read(file).includes('postgres_changes'));
    expect(subscribers.length).toBeGreaterThan(0);

    for (const file of subscribers) {
      const contents = read(file);
      // Each `.on('postgres_changes', {...})` config object must name a filter.
      const configs = contents.match(/table:\s*'[a-z_]+'[^}]*/g) ?? [];
      expect(configs.length, `${relative(REPO_ROOT, file)} has no subscription configs`).
        toBeGreaterThan(0);

      for (const config of configs) {
        expect(config, `unfiltered subscription in ${relative(REPO_ROOT, file)}: ${config}`).toMatch(
          /filter:/,
        );
      }
    }
  });

  it('scopes the plans subscription by domain, the one thing RLS cannot express', () => {
    for (const files of Object.values(filesByApp)) {
      const queries = files.filter((file) => read(file).includes("table: 'plans'"));
      expect(queries.length).toBe(1);
      expect(read(queries[0]!)).toMatch(/table:\s*'plans'[^}]*filter:\s*`domain=eq\.\$\{DOMAIN\}`/);
    }
  });
});

describe('cross-app conveniences degrade to nothing', () => {
  /**
   * Reading the device calendar is how each app notices that the other has
   * already claimed an evening. It must stay a hint: without permission —
   * which is the default, and permanent for anyone who declines — the screen
   * has to keep working. Every call site therefore has to ask first.
   */
  it('never reads the calendar without checking for access in the same file', () => {
    const readers = allAppFiles.filter((file) => read(file).includes('readBusyBlocks'));
    expect(readers.length, 'no calendar readers found — has the API been renamed?').toBeGreaterThan(
      0,
    );

    const offenders = readers
      .filter((file) => !read(file).includes('hasCalendarAccess'))
      .map((file) => relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });

  /**
   * A conflict mark is advice, not a veto. Disabling the choice would claim
   * more certainty about someone's calendar than we have, and would turn a
   * missing permission into a broken screen.
   */
  it('never disables a chip for being busy', () => {
    const offenders = allAppFiles
      .filter((file) => /busy=\{[^}]*\}[^>]*disabled/.test(read(file)))
      .map((file) => relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
