/**
 * Every table a client subscribes to must actually be published.
 *
 * A `postgres_changes` subscription against a table that is missing from the
 * `supabase_realtime` publication is the worst kind of broken: it connects, it
 * reports success, and it silently never fires. Nothing throws, nothing logs,
 * and the screen simply shows stale data forever.
 *
 * That is not hypothetical here. `plan_ideas` was subscribed to by no one and
 * published by no one, because the publication list was written in the
 * intimacy migration before the 2-2-2 tables existed. The shortlist was the
 * one shared list in either app that did not update live.
 *
 * So this guard holds the two halves together: the client's subscription list
 * and the migrations' publication list, which live in different languages in
 * different directories and have no other reason to agree. It is a grep with a
 * reason attached, in the same spirit as `ai-optional.test.ts`, and it needs no
 * database — which matters, because the mistake it catches is one you would
 * otherwise only notice on two phones at once.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IGNORED_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'ios', 'android']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

/**
 * `.on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, …)`
 *
 * The options object has no nested braces, so stopping at the first `}` is
 * enough to keep each subscription's properties together.
 */
const SUBSCRIPTION = /postgres_changes["']\s*,\s*\{([^}]*)\}/g;
const TABLE_PROPERTY = /\btable:\s*["']([^"']+)["']/;
const SCHEMA_PROPERTY = /\bschema:\s*["']([^"']+)["']/;

/** `alter publication supabase_realtime add table public.plans;` */
const PUBLISHED =
  /alter\s+publication\s+supabase_realtime\s+add\s+table\s+(?:public\.)?([a-z_]+)/gi;

function filesIn(dir: string, keep: (file: string) => boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesIn(full, keep, found);
    else if (keep(full)) found.push(full);
  }
  return found;
}

/**
 * The apps backed by the couple database at `supabase/migrations`.
 *
 * Listed rather than discovered, because this guard compares subscriptions
 * against *that* publication specifically. An app with its own Supabase project
 * — `household-chores` has one under `apps/household-chores/supabase` — would
 * be checked against the wrong migrations, and a table it legitimately
 * subscribes to would be reported as unpublished.
 */
const COUPLE_APPS = ['intimacy', 'two-two-two'];

/** Every `(schema, table)` any couple app subscribes to. */
function subscribedTables(): { schema: string; table: string }[] {
  const sources = COUPLE_APPS.flatMap((app) =>
    filesIn(join(REPO_ROOT, 'apps', app), (file) => SOURCE_EXTENSIONS.has(extname(file))),
  );
  const subscriptions: { schema: string; table: string }[] = [];

  for (const file of sources) {
    const contents = readFileSync(file, 'utf8');
    for (const [, options] of contents.matchAll(SUBSCRIPTION)) {
      const table = TABLE_PROPERTY.exec(options ?? '')?.[1];
      if (!table) continue;
      subscriptions.push({ schema: SCHEMA_PROPERTY.exec(options ?? '')?.[1] ?? 'public', table });
    }
  }
  return subscriptions;
}

/** Every table the migrations add to the publication. */
function publishedTables(): Set<string> {
  const migrations = join(REPO_ROOT, 'supabase', 'migrations');
  const published = new Set<string>();

  for (const file of filesIn(migrations, (name) => extname(name) === '.sql')) {
    for (const [, table] of readFileSync(file, 'utf8').matchAll(PUBLISHED)) {
      if (table) published.add(table);
    }
  }
  return published;
}

describe('realtime subscriptions', () => {
  /**
   * Both halves must be non-empty. If either regex quietly stops matching —
   * supabase-js changes its call shape, migrations move — every assertion
   * below would pass over nothing at all and prove exactly nothing.
   */
  it('finds subscriptions and publications to compare', () => {
    expect(subscribedTables().length).toBeGreaterThan(0);
    expect(publishedTables().size).toBeGreaterThan(0);
  });

  it('publishes every table an app subscribes to', () => {
    const published = publishedTables();

    const unpublished = subscribedTables()
      .filter((subscription) => subscription.schema === 'public')
      .map((subscription) => subscription.table)
      .filter((table) => !published.has(table));

    // A subscription to an unpublished table never fires and never errors.
    expect([...new Set(unpublished)]).toEqual([]);
  });

  /**
   * The reverse direction is not an error — a table may be published ahead of
   * the client that will read it — but publishing streams every change to
   * every subscriber RLS allows, so it should be a decision rather than a
   * leftover. Listing them keeps that surface visible in review.
   */
  it('publishes only the tables it means to', () => {
    expect([...publishedTables()].sort()).toEqual([
      'checkins',
      // Both carry key material and no content: a public key, and the couple
      // key sealed to one device. They are published because the pairing and
      // unlock screens are the two places where a missed update is a dead end
      // — nobody to approve you, and no way to tell that apart from a dead
      // socket.
      'couple_key_wraps',
      'device_keys',
      'plan_ideas',
      // Where a plan is happening, which both partners read while deciding
      // whether to go. Its coordinates ride along, and that is the decision
      // being made visible here: they reach the other partner's phone, and
      // nowhere else RLS does not already allow.
      'plan_places',
      'plan_proposals',
      'plans',
    ]);
  });

  /**
   * Invariant 4 — no streaks, no scores — has exactly one mechanical rule, and
   * this is it: `ai_usage` is a counter, and a counter that streams is a
   * scoreboard waiting to happen. The moment it is live on both phones,
   * somebody puts it on a screen.
   *
   * The same assertion exists in `tests/rls/policies.test.ts`, against a real
   * `pg_publication_tables`. It is repeated here because that suite needs a
   * Postgres and this one does not, and the rule is one you would otherwise
   * break in the same commit that adds the publication line — with the fast
   * suite green.
   */
  it('never publishes the usage counter', () => {
    expect([...publishedTables()]).not.toContain('ai_usage');
  });
});

/**
 * Publishing a table is only half of live. A screen that reads key state once
 * and is never told to read it again shows stale data forever, which is the
 * same failure as an unpublished table one layer further up — and it looks
 * identical to the user.
 *
 * `DeviceList` in `recovery-screens.tsx` shipped that way. It fetched on mount
 * and reloaded only after a withdrawal, while the approval that changes
 * `hasKey` happens in `InvitePanel`, a sibling on the same screen. Nothing
 * unmounted, so nothing refetched: the list went on saying a device was
 * "waiting to be let in" after it had been let in and was demonstrably reading
 * the couple's rows. It corrected itself on relaunch, which is the tell for
 * stale state rather than a wrong query — and the wrong answer at exactly the
 * moment someone is checking that the approval worked.
 *
 * The three accessors below are the ones that answer "which devices, and can
 * they read". Any component asking that question has to keep asking it.
 */
const DEVICE_STATE_ACCESSORS = /\bkeys\.(listDevices|pendingDevices|visibleDevices)\s*\(/;

/** Components only — the service that defines these lives in `keys.ts`. */
function authComponents(): string[] {
  return filesIn(join(REPO_ROOT, 'packages', 'auth'), (file) => extname(file) === '.tsx');
}

describe('device state stays live', () => {
  it('has components to check', () => {
    expect(authComponents().length).toBeGreaterThan(0);
  });

  it('watches for key changes wherever it reads which devices hold the key', () => {
    const offenders = authComponents()
      .map((file) => ({ file, contents: readFileSync(file, 'utf8') }))
      .filter(({ contents }) => DEVICE_STATE_ACCESSORS.test(contents))
      .filter(({ contents }) => !contents.includes('useKeyWatch('))
      .map(({ file }) => relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
