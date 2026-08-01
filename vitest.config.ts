import { defineConfig } from 'vitest/config';

/**
 * Default suite: pure logic only. Everything here runs with no database, no
 * network, and no native modules, so it stays fast enough to run on every save.
 *
 * The RLS suite needs a live Postgres and lives in `vitest.rls.config.ts`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'tests/i18n/**/*.test.ts'],
    // The couple's timezone is always passed in explicitly. Pinning the host
    // zone to something other than UTC keeps an accidental `new Date()` or a
    // dropped `timeZone` argument from passing by coincidence.
    env: { TZ: 'Pacific/Auckland' },
  },
});
