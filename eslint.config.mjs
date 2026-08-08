import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/ios/**',
      '**/android/**',
      '**/*.config.js',
      // Same class of file as the `*.config.js` above — CommonJS that a
      // Tailwind config has to `require()` — but not named to match.
      '**/tailwind.preset.js',
      // Written by the Supabase CLI while the local stack runs — it drops a
      // minified edge-runtime bundle in here. Gitignored, but flat config does
      // not read .gitignore.
      // Anchored with `**/` so it also covers an app that brings its own
      // Supabase project, not just the one at the repo root.
      '**/supabase/.temp/**',
      '**/supabase/.branches/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // App and UI code.
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/jsx-key': 'error',
    },
  },

  /**
   * The bilingual invariant, enforced at review time.
   *
   * A literal string in JSX is a string one partner will read in the wrong
   * language. Everything user-visible goes through `t()`; the allowed list is
   * punctuation and separators that are the same in English and Spanish.
   *
   * Scoped to the two bilingual apps rather than all of `apps/**`, because the
   * invariant is about being bilingual, not about being an app —
   * `apps/household-chores` is English-only and has no `t()` to route through.
   * `packages/ui` stays in scope regardless of who consumes it: a shared
   * component that hard-codes a word would put that word in every app at once,
   * which is exactly the thing this prevents.
   */
  {
    files: ['apps/intimacy/**/*.tsx', 'apps/two-two-two/**/*.tsx', 'packages/ui/**/*.tsx'],
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: ['·', '—', '–', '-', '/', ':', '×', '+', '…', ' '],
        },
      ],
    },
  },

  // Edge Functions run in Supabase's edge runtime, which is Deno rather than
  // Node. `Deno` is declared locally in the one function that reads a secret,
  // so this only stops the global itself reading as undefined.
  {
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },

  // Tests describe themselves in English on purpose.
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts', 'packages/data/src/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Test doubles stand in for third-party fluent builders; typing them
      // faithfully would test the double rather than the code.
      '@typescript-eslint/no-explicit-any': 'off',
      'react/jsx-no-literals': 'off',
    },
  },

  prettier,
);
