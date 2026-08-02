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
    include: [
      'packages/*/src/**/*.test.ts',
      // The 2-2-2 app's optional features have to live under
      // `apps/*/src/features/<name>/` for the guards in `tests/guards/`, so
      // their pure modules cannot sit in `packages/` and their tests cannot
      // either. Deliberately `.ts` only: a `.tsx` test would need a renderer,
      // and this suite promises no native modules.
      'apps/*/src/**/*.test.ts',
      // Edge Functions' request/response shaping. Only the plain-TypeScript
      // modules are collected; the Deno entry point that imports them is not.
      'supabase/functions/**/*.test.ts',
      'tests/i18n/**/*.test.ts',
      'tests/guards/**/*.test.ts',
    ],
    // The couple's timezone is always passed in explicitly. Pinning the host
    // zone to something other than UTC keeps an accidental `new Date()` or a
    // dropped `timeZone` argument from passing by coincidence.
    env: { TZ: 'Pacific/Auckland' },
  },
});
