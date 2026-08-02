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

   There is exactly one accessor that reads across it, and the shape of the
   exception is the point. `createBusyRepository` reads `plan_busy_times`, a
   view selecting `couple_id`, `starts_at` and `ends_at` and nothing else — so
   it cannot take a domain because there is no domain column to take one, and
   a caller learns that a window is occupied without learning what occupies it.
   Widening it means changing the view, in a migration, in review. The 2-2-2
   app gates reading it on a device-local setting that starts off; the intimacy
   app does not, because what it discloses in that direction is that a date
   night is booked. (`tests/guards/standalone.test.ts`, `tests/rls/`)

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
supabase/functions/   Edge Functions — the only place a third-party key lives
tests/i18n/, tests/rls/, tests/e2e/, tests/guards/
```

Per-app optional features live in `apps/<app>/features/<name>/`, with anything
that assumes an external dependency confined to a named subdirectory
(`ai/`, `maps/`). See the two optional-dependency rules below.

Shared packages ship **TypeScript source**, not builds — Metro transpiles them.
There is no build step and no `dist/` to go stale.

## Commands

```bash
npm run lint             # eslint
npm run typecheck        # tsc across every workspace
npm test                 # unit tests (no database needed)
npm run db:test          # RLS + end-to-end suites — needs Postgres (see below)
npm run intimacy         # expo start
npm run two-two-two      # expo start
```

`npm run db:test` builds a throwaway database from `supabase/migrations` and
runs against it. It needs a Postgres reachable via the standard `PG*`
variables — either `supabase start`, or any plain Postgres 16, because
`tests/rls/supabase-shim.sql` recreates the Supabase surface the migrations
touch (roles, `auth.users`, `auth.uid()`, the realtime publication, and the
default grants). The security-critical tests must not be the ones gated behind
the heaviest dependency. On a Homebrew cluster:

```bash
brew install postgresql@16 && brew services start postgresql@16
cp .env.example .env    # then set PGUSER to your OS username
npm run db:test
```

The root `.env` is read by `vitest.rls.config.ts` through Node's own
`process.loadEnvFile` — no dotenv dependency — and only ever points at a local
throwaway database, never at Supabase. Shell variables still win over it, so
`PGHOST=… npm run db:test` overrides the file for a one-off, and CI needs no
`.env` at all. The apps' `.env` files are separate and live in `apps/*/`.

Two suites live behind it. `tests/rls/` checks the policies statement by
statement. `tests/e2e/journey.test.ts` walks the path a couple actually takes —
pair, rotate the code, turn a third person away, set two locales, propose,
accept, reconcile both devices' calendars, counter, complete — against the real
migrations, the real policies, the real cadence engine and the real translation
bundles. It is the only place the pieces are checked together, and it is where
a schema change that typechecks but does not _work_ gets caught.

What it deliberately does not cover, because Node cannot: email OTP delivery
(that is Supabase's auth service — rows are inserted into `auth.users`
directly), PostgREST (statements run over a socket as the `authenticated` role,
not through supabase-js), and writing to a device calendar. No automated test
covers any of them, so treat a green suite accordingly.

**`docs/simulator-walk.md` is the checklist for that gap** — a dev build on two
simulators against a local stack, covering the auth service, the second
install, discretion on the device (calendar titles, reminder copy, the lock),
the two-partner paths, and free/busy with each of its three sources removed in
turn. Run it before a release and after any change to `packages/device`, the
propose or plan screens, or the busy-times view. It needs a Mac: neither app
runs in Expo Go, so a dev build is not optional.

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
  cannot be enumerated through the table API. The code rotates once redeemed —
  and again whenever the couple loses a member, because leaving reopens the
  seat and would otherwise make a circulated code live again.
- **A couple with no members left is deleted, not kept.** Nothing can reach an
  empty couple's rows through any policy, so retaining them serves nobody and
  leaves intimate history sitting behind a redeemable code.
- Authorship columns (`created_by`, `saved_by`, `profile_id`, `proposed_by`)
  and `couple_id` are pinned immutable by trigger. Every authorship rule in RLS
  is an insert-time `with check` and the update policies test only membership,
  so without the pin each rule was one `UPDATE` away from meaningless.
- **Never store a push token.** Reminders are local (invariant 3), a partner
  can read the whole profile row, and an Expo token is a bearer credential for
  writing to that device's lock screen. `profiles.expo_push_token` was carried
  and never written; it is gone. Push would need its own table and its own
  argument for overriding discretion.
- All RLS lives in one migration so the access surface is reviewable at a
  glance.
- A table read live on both phones needs **two** things that live far apart: a
  `postgres_changes` handler in the app's `useRealtimeSync`, and a migration
  adding it to the `supabase_realtime` publication. Subscribing to a table that
  was never published connects, reports success, and then silently never fires
  — `plan_ideas` shipped that way, so the shortlist was the one shared list in
  either app that did not update live.
  `tests/guards/realtime-subscriptions.test.ts` holds the two lists together,
  and doubles as the register of what streams at all: `ai_usage` is
  deliberately absent, since a live counter is a scoreboard waiting to happen.

## Environment

`apps/intimacy/.env` (see `.env.example`):

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Third-party keys go in `supabase/functions/.env` (see its `.env.example`), never
here — `supabase secrets set` on a hosted project. All of them are optional:
with none set, `npm test` passes, both apps bundle, and the 2-2-2 app's places
feature works with venues typed by hand.

## Dev builds

**Neither app runs in Expo Go at all.** It is not a limitation to work around;
Expo Go segfaults on launch, in `worklets::jsi_utils::addMethod` inside its own
compiled binary, before any of our JavaScript gets a chance to matter. A stock
blank Expo app runs in the same Expo Go, so it is these apps' native surface —
Reanimated 4 and worklets against a binary built elsewhere — not the tooling.
`npm run ios` therefore runs `expo run:ios`, which compiles the native modules
at the versions in `node_modules`. That works.

Even if it launched, Expo Go could not grant calendar, notification, or
biometric permissions, so `packages/device` would be inert in it —
`hasCalendarAccess()` returns false and `useDeviceSync` correctly does nothing.

**`docs/manual-verification.md` is the walk to do on that build.** It covers
what no suite reaches — OTP delivery, PostgREST, the device calendar, the
keychain and any live model — as numbered steps with an expected result each.
Anything touching pairing, the calendar, or the BYOK suggestion path should be
walked there before it is believed.

```bash
cd apps/intimacy && npm run ios     # local dev build, ~5 min the first time
```

If `pod install` dies with `Unicode Normalization not appropriate for
ASCII-8BIT`, that is CocoaPods on Ruby 4 in a non-UTF-8 shell — and its error
reporter crashes while formatting the _real_ error, so the message is doubly
unhelpful. Prefix the command with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.

When driving the simulator, read the accessibility tree rather than trusting a
screenshot — `axe describe-ui` gives every element's label and frame. Simulator
screenshots can lag the running app by whole screens, and a stale one is
indistinguishable from a frozen app: it cost a full debugging detour here,
diagnosing a "dead" pairing screen that had in fact already navigated away. The
tree also gives exact tap coordinates instead of arithmetic on pixel sizes.

For a build on Expo's infrastructure instead, both apps carry an `eas.json`:

```bash
cd apps/intimacy && npx eas build --profile development --platform ios
```

The `development` profile targets the iOS Simulator; `device` builds for real
hardware, which is what Face ID and delivered notifications need. `npx expo
prebuild --platform ios` generates `ios/` locally to inspect the native config
without a build — it is gitignored, and it rewrites the app's `ios`/`android`
package scripts as a side effect, so check `git diff` afterwards.

EAS does not see your `.env`; set `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` as EAS environment variables. **Anon key
only** — see below.

## Environment

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

2-2-2-owned tables are `plan_ideas`, `plan_places`, `ai_usage` and
`places_usage`, plus the `places` Edge Function. They are reached through
`createIdeaRepository` and `createPlaceRepository` in `packages/data` — their
own factories, next to the intimacy-owned `createCheckinRepository`, so the
other app has nothing to import even by accident. Both hard-code their domain
rather than taking one,
because a domain parameter is the exact shape invariant 2 forbids.

`plan_places` is a side table rather than columns on `plans` because `plans` is
shared and replicated; it carries a composite foreign key `(plan_id,
couple_id)` into `plans` so its denormalized `couple_id` cannot be forged, the
same trick `plan_proposals` uses.

### The two optional-dependency rules

Both apply to the 2-2-2 app only, both have the same shape, and both are
enforced by a guard rather than remembered:

- **AI-optional** — no path outside `features/<name>/ai/` may assume a model
  exists (`tests/guards/ai-optional.test.ts`).
- **Maps-optional** — no path outside `features/<name>/maps/` may name a
  mapping provider, and _no path anywhere_ may put a provider key in an
  `EXPO_PUBLIC_` variable (`tests/guards/maps-optional.test.ts`).

Both exempt `supabase/functions/`, which is where a key legitimately lives.
They share one walker in `tests/guards/sources.ts`.

Each guard also checks that the no-dependency path still _works_, by importing
the modules it actually runs through — a grep that passes over a feature nobody
can use proves nothing. For AI that is the curated idea library
(`apps/two-two-two/src/ideas.ts` for the ids, `locales/{en,es}/ideas.json` for
the text) plus manual entry. For maps it is `features/places/label.ts` and
`link.ts`: a venue typed by hand, and an "Open in Maps" OS URL scheme that
needs no key at all. `ai_usage` and `places_usage` simply stay empty.

**The app never learns whether a mapping key exists.** It asks the `places`
Edge Function (`op: 'capabilities'`), which is the only thing holding one, and
every search control renders `null` when the answer is no. That is why there is
no `EXPO_PUBLIC_` feature flag — the key's *name* never enters the bundle
either. `EXPO_PUBLIC_` values ship inside the app and can be read back out of
it; that is fine for the anon key, which has RLS behind it, and not for a
billed third-party key, where possession is the authorization.

### Accommodation: a link, because there is no integration to build

**Airbnb has no API this app could ever hold a key for.** The public API was
retired years ago and the partner programme (`developer.withairbnb.com`) is
closed to unsolicited applicants — vetted property-management systems and
channel managers only, approached by Airbnb rather than applying. So there is
no search to proxy, no listing data to show, and nothing for the proxy pattern
above to wrap. Third-party scraper APIs sell the data; they are somebody else
reselling a site's contents, and pointing a couple's private planner at one
would add a paid dependency and a legal question to answer a need a URL
answers.

`features/places/stays.ts` therefore builds a deep link and nothing else. The
couple has already supplied the only two facts an accommodation search needs —
the nights and roughly where — so the link arrives with both filled in and they
finish on Airbnb's own site, as themselves. No key, no account, no request from
us to anyone, nothing sent until somebody taps. Offered only for `getaway` and
`trip`, since a date night ends at home.

Dates go through `calendarDateIn` in the couple's timezone, never
`toISOString()`: a night is a calendar date, and an evening departure is
already tomorrow in UTC. **No affiliate or referral tagging** — quietly earning
on two people's weekend away is a product decision with a conversation
attached, not a query parameter. A test asserts the URL carries only the three
parameters it means to.

Suggestions are the optional third source, in
`apps/two-two-two/src/features/date-planner/ai/`, and they are **BYOK**: each
partner stores their own OpenRouter or Gemini key in the device keychain
(`expo-secure-store`), and requests go from that device straight to that
provider. There is no Edge Function and no server of ours in the path — which
is why `ai_usage` stays empty in practice as well as in principle: it is
`select`-only to clients and only a service role could ever write it. A key is
per person and per device; it is never written to a table and the partner never
sees it. The prompt in `prompt.ts` is the only thing that leaves the device, and
it carries the kind, the language, a count and three free-text fields the user
filled in — where, what budget, and anything else — never a plan, a check-in, an
id, the couple's timezone, or the shortlist. A location leaves and a timezone
does not, which is not a contradiction: a city typed into a labelled field is
chosen and as coarse as the user wants, where an inferred timezone is neither.

Those three fields live in a session store (`session-inputs.ts`, the repo's only
zustand use) rather than in the card, because the card unmounts on a tab change
and nobody should retype their city for that. **Budget is keyed by kind** — a
casual evening and a fortnight away are different numbers — while location is
shared across kinds. None of it is persisted: no `persist` middleware, nothing
in `expo-secure-store`, and it is emptied on sign-out. Session-lived is the
whole convenience; on-disk would leave a place-you-go at rest to save two
seconds of typing.

Because the rule is only worth what its markers catch, `MODEL_MARKERS` in the
guard covers both providers' hosts and keychain item names, not just Anthropic.
Adding a third provider means adding its markers in the same commit.

The library is _ours_, so it is translated like any other chrome and each
partner reads it in their own language. Manually entered ideas are the other
case — partner-authored, shown verbatim, and labelled with the language they
were written in when that differs from the reader's. A suggestion is a model's
words rather than ours, so it is treated the same way as a partner's: generated
in the asker's language, stored with that `locale`, shown verbatim, and labelled
rather than machine-translated for the partner reading in the other one. A
place follows the same rule with one wrinkle: a venue name is a proper noun and
is never labelled, while its address is.

A place's address reaches a device calendar only when that place carries
`share_with_calendar`, which is off by default —
`DeviceSyncOptions.calendarLocationFor` is optional, so the intimacy app is
unaffected. A title is one thing; an address syncs to shared computers as "we
are not home, and here is where we are".

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
