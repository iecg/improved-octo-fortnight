/**
 * Migration filenames, which two different mechanisms disagree about.
 *
 * `tests/rls/harness.ts` builds its throwaway database by sorting the directory
 * and running every file. The Supabase CLI does something else: it reads the
 * `version` prefix, checks it against `supabase_migrations.schema_migrations`,
 * and records it — and that table is keyed on the version.
 *
 * So a duplicate prefix is invisible to the suite and fatal to the CLI. That is
 * exactly what happened: `20260802000400_data_protection.sql` and
 * `20260802000400_plan_ideas_realtime.sql` arrived from two pull requests that
 * were open at the same time, both applied cleanly under `npm run db:test`
 * forever, and would have collided on the primary key the first time anyone ran
 * `supabase db reset`.
 *
 * Cheap to check, and the failure it prevents lands on whoever next tries to
 * stand up a real database rather than on whoever caused it.
 */
import { readdirSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));

/** `20260802000400_data_protection.sql` -> `20260802000400` */
const VERSIONED = /^(\d{14})_[a-z0-9_]+\.sql$/;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((entry) => extname(entry) === '.sql')
    .sort();
}

describe('migration filenames', () => {
  it('finds migrations to check', () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it('names every migration `<version>_<name>.sql`', () => {
    const malformed = migrationFiles().filter((file) => !VERSIONED.test(file));
    expect(malformed).toEqual([]);
  });

  /**
   * The one that matters. `schema_migrations.version` is the primary key, so
   * two files sharing a prefix cannot both be recorded.
   */
  it('gives every migration its own version', () => {
    const seen = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const version = VERSIONED.exec(file)?.[1];
      if (!version) continue;
      seen.set(version, [...(seen.get(version) ?? []), file]);
    }

    const collisions = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(collisions).toEqual([]);
  });

  /**
   * Sorting the directory and sorting the versions must agree, because the two
   * consumers do it differently — the harness sorts filenames, the CLI orders
   * by version. They only coincide while the names are well formed, and a
   * migration that runs in a different order in the suite than in production
   * is the worst kind of green.
   */
  it('runs in the same order however it is sorted', () => {
    const byFilename = migrationFiles();
    const byVersion = [...byFilename].sort((a, b) =>
      (VERSIONED.exec(a)?.[1] ?? '').localeCompare(VERSIONED.exec(b)?.[1] ?? ''),
    );
    expect(byFilename).toEqual(byVersion);
  });
});
