# Couple apps monorepo

Two apps for the same two people, sharing one backend and one pairing:

- **`apps/intimacy`** ("Us") — short-cadence private scheduling: propose and
  confirm time together, standing rituals, daily check-ins.
- **`apps/two-two-two`** ("Two22") — the 2-2-2 rule: date night every 2 weeks,
  a getaway every 2 months, a big trip every 2 years.

Pairing happens once and serves both. Installing the second app finds the
couple already connected.

## Invariants

Break these and the product stops working as designed. They are each backed by
a test, listed with them.

1. **Bilingual per partner, not per couple.** `profiles.locale` is per person.
   Two partners read the same rows in different languages, at the same time.
   _Chrome is translated; partner-written text is shown verbatim and is never
   machine-translated._ No string literals in JSX (enforced by
   `react/jsx-no-literals`); en/es keys, plural forms, and interpolation
   placeholders must match (`tests/i18n/parity.test.ts`, which auto-discovers
   any `locales/` directory in the workspace).

2. **The domain boundary between the apps.** RLS _cannot_ enforce this — both
   partners are legitimate members of the couple, so the database has no basis
   to hide `domain = 'intimacy'` rows from the 2-2-2 app. It holds only because
   `packages/data` takes a domain at construction, filters every read on it,
   and stamps every write. **Never export a raw table client, and never add a
   method that takes `domain` as a per-call argument.**
   (`packages/data/src/repository.test.ts`)

3. **Discretion.** Nothing intimate reaches a lock screen, a notification
   payload, or a calendar entry. Calendar events carry a user-chosen neutral
   label only. Reminders are _local_, composed on the recipient's own device —
   which is also why each partner is reminded in their own language for free.

4. **No streaks, no scores.** A "not tonight" is a neutral answer, styled
   identically to "yes". There is deliberately no counter to break. An app that
   turns a no into a failure makes the problem it exists to solve worse.

5. **The cadence engine is pure.** No I/O, no React, no i18n, no `new Date()`
   in `packages/cadence`. It returns structured data and translation _keys_.
   All date arithmetic goes through the couple's timezone.
   (`packages/cadence/src/*.test.ts`)

## Layout

```
apps/intimacy/      Expo app — expo-router, NativeWind
apps/two-two-two/   Expo app — same scaffold, different domain
packages/core/      Domain types + kind catalogs (no deps)
packages/auth/      Sign-in + pairing screens, session provider (shared)
packages/cadence/   PURE recurrence engine + free-window search
packages/data/      Supabase client, domain-scoped repositories
packages/i18n/      i18next bootstrap, shared namespaces, date formatting
packages/ui/        Shared components (no strings)
packages/device/    expo-calendar / notifications / local-auth wrappers
supabase/migrations/  SINGLE source of truth for both apps
tests/i18n/, tests/rls/
```

Shared packages ship **TypeScript source**, not builds — Metro transpiles them.
There is no build step and no `dist/` to go stale.

## Commands

```bash
npm run lint             # eslint
npm run typecheck        # tsc across every workspace
npm test                 # unit tests (no database needed)
npm run db:test          # RLS suite — needs Postgres (see below)
npm run intimacy         # expo start
npm run two-two-two      # expo start
```

`npm run db:test` builds a throwaway database from `supabase/migrations` and
runs the policies against it. It needs a Postgres reachable via the standard
`PG*` variables — either `supabase start`, or any plain Postgres 16, because
`tests/rls/supabase-shim.sql` recreates the Supabase surface the migrations
touch (roles, `auth.users`, `auth.uid()`, the realtime publication, and the
default grants). The security-critical tests must not be the ones gated behind
the heaviest dependency.

## Data model notes

- `cadences` and `plans` are keyed by **`(domain, kind)`**, both `slug` text
  rather than enums. The engine treats `kind` as opaque, so adding a ritual —
  or a third app — is a TypeScript constant in `packages/core/src/kinds.ts`
  plus two translation keys. Never a migration.
- Enum values are stored as English machine tokens (`not_tonight`) and
  rendered through translation keys. **Never store a display string.**
- `plans.calendar_event_ids` is a `profile_id -> event id` map because each
  partner's phone returns its own identifier for the same logical event.
- Pairing is the `join_couple` RPC, never a client insert, so invite codes
  cannot be enumerated through the table API. The code rotates once redeemed.
- All RLS lives in one migration so the access surface is reviewable at a
  glance.

## Environment

`apps/intimacy/.env` (see `.env.example`):

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

`EXPO_PUBLIC_` values are embedded in the app bundle. Only the anon key belongs
there — RLS is what protects the data, never key secrecy.

## What the two apps share, and what they don't

Shared, and must stay shared: sign-in, pairing, and the session provider
(`packages/auth`); the cadence engine; the `common` / `cadence` / `plans` /
`auth` translation namespaces; the schema. **There is one account and one
pairing across both apps** — if you find yourself copying an auth screen into
an app, that invariant is about to break.

Per app: its screens, its `app` translation namespace, its kind catalog, and
its `createDomainRepository(client, '<domain>')` binding.

2-2-2-owned tables are `plan_ideas` and `ai_usage`, plus the planned
`suggest-ideas` Edge Function. Its AI-optional rule — no path outside
`features/*/ai/` may assume a model exists — applies to that app only. The
curated idea library and manual entry are what make the feature work with no
key configured; `ai_usage` simply stays empty.

Ported from `iecg/legendary-bassoon` (now superseded). Two bugs found there
and guarded against here, both with tests: a `count(*)`-based couple-size
trigger cannot stop two concurrent redemptions of one invite code, and a
column-wide `grant update on couples` lets a client overwrite its own invite
code. Its CSPRNG invite-code generator, its `completed_at` biconditional, and
its `on delete set null` on `created_by` were better than what was here and
were adopted.

## Version notes

Expo SDK 57 / React 19.2 / RN 0.86 / TypeScript 6. Two things that differ from
older material an agent may have absorbed:

- **`expo-calendar` replaced the `*Async` free functions with an
  object-oriented API.** The old names still exist but _throw at runtime_ when
  imported from `expo-calendar`. Use `getCalendars()`, `calendar.createEvent()`,
  `ExpoCalendarEvent.get()`, `event.update()` / `.delete()` — see
  `packages/device/src/calendar.ts`.
- **Metro keeps hierarchical lookup enabled**, unlike the snippet in Expo's
  monorepo guide. That guide targets pnpm/yarn; npm workspaces leave some
  transitive dependencies nested, and disabling the walk-up makes them
  unresolvable. `babel-preset-expo` is also declared explicitly for the same
  reason.

When touching a native module, read its `.d.ts` in `node_modules` rather than
recalling the API. It has moved recently.
