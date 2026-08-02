import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Pick up a root `.env` if one exists, so a copied `.env.example` is enough to
 * run this suite instead of retyping `PG*` on every invocation.
 *
 * `process.loadEnvFile` is Node's own — no dotenv dependency — and it leaves
 * variables already set in the shell alone, so a one-off
 * `PGHOST=… npm run db:test` still wins. Guarded because it throws when the
 * file is absent, which is the normal case in CI where `PG*` comes from the
 * service definition.
 */
const rootEnv = fileURLToPath(new URL('.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * Row-level-security suite. Separate from the default config because it needs
 * a live Postgres — `npm test` must stay runnable with nothing installed.
 *
 * Point it at a database with `RLS_TEST_ADMIN_URL`; it creates and drops its
 * own throwaway database from there.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rls/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    // Each test file builds its own database; running them in parallel would
    // race on create/drop.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
