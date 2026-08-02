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
  it('scopes every plans subscription by domain, the one thing RLS cannot express', () => {
    for (const [app, files] of Object.entries(filesByApp)) {
      const subscribers = files.filter((file) => read(file).includes("table: 'plans'"));
      expect(subscribers.length, `${app} does not subscribe to plans`).toBe(1);
      expect(read(subscribers[0]!)).toMatch(
        /table:\s*'plans'[^}]*filter:\s*`domain=eq\.\$\{DOMAIN\}`/,
      );
    }
  });

  /**
   * Whether a subscription is filtered is a decision, not a default, so the
   * whole set is asserted at once — in the same spirit as the publication list
   * in `./realtime-subscriptions.test.ts`.
   *
   * The unfiltered entry is the one that matters to get right. Realtime matches
   * a filter against the replica identity, and under the default identity a
   * delete carries only the primary key — so filtering on anything else
   * silently drops deletes, which connect, report success and never fire.
   * `plan_ideas` is the one table here that is genuinely deleted from
   * (`useRemoveIdea`), and it is 2-2-2-owned outright, so it has no boundary to
   * protect and everything to lose from a filter. Nothing deletes a plan, a
   * proposal or a check-in from any screen; if that changes, the filter on that
   * table has to go and this list is where the argument gets had.
   */
  it('filters each subscription deliberately', () => {
    const found = allAppFiles
      .flatMap((file) => {
        const contents = read(file);
        return [...contents.matchAll(/postgres_changes['"]\s*,\s*\{([^}]*)\}/g)].map((match) => {
          const options = match[1] ?? '';
          return {
            table: /\btable:\s*['"]([^'"]+)['"]/.exec(options)?.[1] ?? '?',
            filter: /\bfilter:\s*`([a-z_]+)=/.exec(options)?.[1] ?? null,
          };
        });
      })
      .sort((a, b) => a.table.localeCompare(b.table));

    expect(found).toEqual([
      { table: 'checkins', filter: 'couple_id' },
      { table: 'plan_ideas', filter: null },
      { table: 'plan_proposals', filter: 'couple_id' },
      { table: 'plans', filter: 'domain' },
      { table: 'plans', filter: 'domain' },
    ]);
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
