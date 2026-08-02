import { defineConfig } from 'vitest/config';

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
