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

   Since encryption, this is also arithmetic: each domain gets its own content
   key derived from the couple root, so the 2-2-2 app's cipher **cannot open**
   an intimacy payload even if a bug hands it the row. That is a defence
   against the code, not against the person — both partners hold the root key
   and can derive either scope. The convention above still stands; it now has a
   second lock behind it.

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
tests/i18n/, tests/rls/, tests/e2e/, tests/guards/
```

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
not through supabase-js), and writing to a device calendar. All three have been
walked by hand on a simulator dev build against the local stack — sign in with
a real code, check in, search free/busy, propose, and watch a partner-booked
plan produce a calendar entry titled with the neutral label and nothing else —
but no automated test covers them, so treat a green suite accordingly.

## Encryption

Everything a partner writes is sealed on the device that wrote it. RLS answers
"can another couple read this"; it cannot answer "can the operator read this,"
because policies apply to the `authenticated` role and the operator connects as
owner or `service_role`. Only client-side encryption answers that.

**Sealed** into one `payload` per row: `plans.title/notes/location`,
`checkins.note` **and `checkins.interest`/`energy`**, `plan_ideas`' title,
summary, url, cost band and locale, and `profiles.name_payload`. The interest
level is in there because `yes` / `maybe` / `not_tonight` is the most revealing
value in the schema — as an enum column it was published in the clear for every
check-in ever made.

**Readable**, because RLS, foreign keys and the authorship triggers need them:
ids, `couple_id`, `created_by`/`proposed_by`/`saved_by`, `domain`, `kind`, every
date, `status`, `response`, `plan_ideas.source`.

One blob per row rather than a ciphertext per column, and not for efficiency:
with a column each, `notes is null` would tell anyone reading the table whether
a note exists on every plan in it. The AAD binds table, couple and row key, so
ciphertext cannot be moved between rows, couples or tables — and check-ins bind
to `(couple_id, profile_id, on_date)`, not to `id`, because `record()` upserts
on that natural key and Postgres keeps the existing row's id on conflict.

`packages/crypto` is pure the way `packages/cadence` is pure: no React, no I/O,
no native modules, and **no ambient globals**. Randomness is injected as a
`RandomSource`, and UTF-8 and base64 are hand-written, because Expo SDK 57's
winter runtime supplies `TextDecoder` but not `TextEncoder` and Hermes has no
`btoa` — importing them would work under Node and fail on device.

Per-field length limits are enforced client-side now; the `CHECK` constraints
bound ciphertext only. That moves an integrity rule off the server, though the
only party it ever protected against was the couple themselves. The display
name's 1..80 rule lives in `packages/core/src/name.ts` — in `core` rather than
beside the seal because the repository and the screen both need the same answer,
and a rule enforced in one and guessed at in the other is how the two drift. It
counts **code points**, so an emoji is the one character it looks like.

The two limits were written at different times and are checked against each
other rather than assumed: `tests/e2e/journey.test.ts` seals a name of 80
four-byte characters — the longest the rule admits, 320 bytes rather than the 80
an ASCII reading would suggest — and asserts the result lands inside
`profiles_name_payload_bounded`'s 64..1000. It comes to ~576 base64 characters,
so there is room; at 300 it would be 1768 and the insert would fail on a name
somebody had actually typed.

`tests/guards/no-plaintext-content.test.ts` is what keeps this true: an
allowlist of every column of every table, cross-checked against every key
`packages/data` sends to PostgREST.

### How the key reaches a device

Every install mints an X25519 keypair, keeps the secret in the keychain and
publishes the public half to `device_keys`. A device that already holds the
couple key wraps it to a published public key; the two people compare a
twelve-character **safety number** first, which is what stops the server
substituting a key of its own. The wrap is static-static ECDH, not a sealed
box — with a sealed box anyone holding the recipient's public key could forge a
plausible wrap, so the tag would prove nothing about who sent it.

**There is a fourth app state now: paired but keyless.** `SessionState.keyState`
carries it and `routeIntent` in `packages/auth/src/route.ts` decides on it —
one pure function, because the expression was duplicated character-for-character
in both `_layout.tsx` files and a fourth state was not something to copy again.
A keyless session routes to `/unlock`, never to the tabs. `usePairedSession()`
asserts the same thing, so a screen that slips past the router fails loudly
instead of meeting `MissingCoupleKeyError` inside a mapper.

`/approve` is deliberately exempt from that redirect for a session that _has_
the key: gating the approver behind an approval is the deadlock the screen
exists to break.

**Approving your own device is a normal path, not a workaround.** SecureStore is
scoped per app bundle, so installing the second app on one phone produces a
paired, keyless device belonging to _you_. `pendingDevices` therefore returns
devices of either member with an `isMine` flag. Without that, "installing the
second app finds the couple already connected" would have stopped being true the
moment encryption shipped.

Two keychain items with two different accessibility levels, and the difference
is deliberate: the **device secret** is `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so a
restored backup does not produce two phones answering to one `device_keys` row;
the **couple key** is `AFTER_FIRST_UNLOCK`, so it rides an encrypted backup to a
new phone. Neither uses `requireAuthentication` — such keys are invalidated when
biometrics change, which would make every row unreadable with no recovery, and
the flag does not combine with `keychainService`. A lock screen belongs at the
app layer, where `AppLockGate` already puts it.

Note one asymmetry worth remembering: a wrap row is the **only** evidence any
other device can see that a device holds the key. That is why the founding
device wraps the key to itself — not for recovery (a reinstall mints a new
keypair and could not open it), but so its own second install does not offer to
re-approve it.

**When the numbers don't match, the two sides do different things, and the split
is not arbitrary.** Nothing has been written at that moment — the wrap only
happens on approve — so the approver has nothing to undo and their action is to
_dismiss_ and write nothing. It cannot be to revoke: `device_keys_delete_own`
scopes deletion to your own rows, and a partner's row is their claim about their
own phone (`tests/rls/policies.test.ts`). The remedy is `resetDeviceKey`, on the
waiting device, which mints a fresh keypair and withdraws the old row.
Republishing would achieve nothing — the safety number is a function of the
keypair, so the same keypair reads out the same twelve characters however often
it is announced. A _new_ keypair gives a new number, and that is what separates
"we misread it" from "something is between these two phones": after a rotation
the numbers should agree, and if they still don't, that is a signal.

**`InvitePanel` is the invite code and the approval in one card**, on the pairing
screen and in both apps' Settings. It shows the code until a device appears and
then shows the safety number in its place — which is also what keeps a _stale_
code off the screen, since `join_couple` rotates the code the instant it is
redeemed and never tells this device. The distinction it turns on is `isMine`:
your own second install publishes a device key without redeeming anything, so it
must not retire a code that is still good.

The two waiting screens poll every five seconds on top of their realtime
subscription. `npm run db:test` runs SQL over a socket and never touches
Realtime, so nothing in the suite proves a `postgres_changes` subscription is
delivered under RLS over a websocket — and these are the only screens where a
missed update is a dead end, with no pull-to-refresh and no way to tell "nobody
has joined" from "the socket is dead".

### The three ways back in

`/unlock` is one of them, and for a long time it was the only one: a partner
approves you. That covers everything except both phones losing the key at once,
where `/unlock` waits for a partner who is also waiting. `/recovery` — reachable
from "I can't get in", keyless-only, grouped with `/unlock` in `routeIntent` —
presents all three in ascending destructiveness, and the order on screen is the
order to try them in.

**The recovery code is one person's, not the couple's.**
`couple_key_recovery.profile_id` is the primary key and `couple_key_recovery_all_own`
is the only policy in this schema that hides a row from the _partner_. It has to:
partner re-wrap is a different rung and does not touch this row, so there is no
reason for the other person to hold a second offline-attackable copy of the key.
The code is generated rather than chosen — 125 bits — which is what makes a pure-JS
scrypt sufficient, and it is shown exactly once because the envelope cannot be
turned back into it. Both halves of it are `async` and use `scryptAsync`: the
synchronous variant holds the JS thread for the whole derivation, which would
freeze the very spinner the screen puts up to explain the wait. `kdf_params` comes back from the server and is fed to a KDF,
so `packages/data` bounds it before use: it is the one value in this schema an
operator could edit into work rather than into a failed tag.

**Starting over is unpairing, not a key rotation, and the reason is arithmetic
rather than taste.** A rotation would mint a new root at `epoch + 1` and leave
every existing row sealed under a key nobody holds — and the client _cannot_
clear them, because `checkins_delete_own` and `plan_proposals_delete_own` scope
deletion to your own rows, so one partner's check-ins would outlive whatever the
other did. They would render as `unreadable` placeholders on every list, forever.
Leaving the couple deletes it through `handle_member_departure` and a cascade
instead, which reaches every table regardless of who is asking
(`tests/rls/policies.test.ts` asserts it for content and for key material both).

It takes both people, and the screen says so: leaving reopens the seat, and the
couple dies only when the second person leaves. If the partner can still open the
app, the right rung is the first one.

So **the `epoch` columns stay unused on purpose.** They are for a rotation that
re-seals every row — a real feature, needing a cipher that holds two keys at once
and a migration that survives being interrupted. `createFieldCipher` refusing to
cross an epoch is that feature's first line, not an oversight to "use up".

**There is no revoke, and Settings' device list says so.** `device_keys_delete_own`
means you can withdraw your own rows and never your partner's, and withdrawing
takes back nothing — the key is in that device's keychain, not in this table. The
card lists every device, whether each holds the key, and the safety number to
compare, and states both limits rather than implying a control it does not have.

### What this does not protect

The first item is the deliberate limit of the whole design, not a gap in it.

1. **A malicious app build.** Whoever ships the binary can ship one that
   uploads the keys. End-to-end encryption makes the _server alone_ incapable of
   reading the data — not the developer permanently incapable. The mitigations
   are process: open source, reproducible builds, published hashes.
2. **Metadata.** That these two accounts are a couple, when they paired, how
   many rows exist, the exact date and time of every plan, which days each
   partner checked in, every status, and `domain`/`kind`. An operator can see
   that this couple has an `intimacy/intimacy` plan on Friday at 19:00. Not a
   word of what it says, and not whether the answer was yes.
3. **Length, approximately.** Payloads pad to 64-byte buckets, which blunts it;
   a very long note is still visibly long.
4. **Rollback and withholding.** The AAD stops relocation. It does not stop
   restoring an older ciphertext for the same row, deleting rows, or serving one
   partner a stale view. Integrity is per row, not per database.
5. **The device.** An unlocked phone, a compromised OS, a screenshot. Note the
   trade: the couple key is stored _without_ `THIS_DEVICE_ONLY` so an encrypted
   backup can restore it — a recovery feature and an exposure at once.
6. **Your partner.** By design.
7. **Availability.** Lose both devices and the recovery code and the history is
   gone. Nobody, including the developer, can reset it. That is what "the server
   cannot read it" means, spelled out.
8. **The mailbox.** Sign-in is email OTP, so whoever controls it can sign in and
   ask the partner to approve a new device. The only barrier is the human step —
   real, and thin.
9. **Search, forever.** No server-side search, filter or sort over content is
   possible any more. A consequence rather than a gap, but the one that will be
   forgotten and then proposed as a feature.

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
- **`PairScreen` must not refresh the session while it is showing the invite
  code.** Refreshing sets `couple`, the router replaces the screen, and the
  founder's only sight of their own code is the render it is unmounted on. The
  Continue button is what advances instead. This was a real bug before
  encryption and would have been permanent after it, since minting the couple
  key makes `keyState` ready on the same tick.
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

## Environment

`apps/intimacy/.env` (see `.env.example`):

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

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

2-2-2-owned tables are `plan_ideas` and `ai_usage`, plus the planned
`suggest-ideas` Edge Function. They are reached through
`createIdeaRepository` in `packages/data/src/ideas.ts` — its own factory, next
to the intimacy-owned `createCheckinRepository`, so the other app has nothing
to import even by accident. It hard-codes its domain rather than taking one,
because a domain parameter is the exact shape invariant 2 forbids.

Its AI-optional rule — no path outside `features/<name>/ai/` may assume a model
exists — applies to that app only, and is enforced by
`tests/guards/ai-optional.test.ts` rather than remembered. The curated idea
library (`apps/two-two-two/src/ideas.ts` for the ids, `locales/{en,es}/ideas.json`
for the text) and manual entry are what make the feature work with no key
configured; `ai_usage` simply stays empty. The guard also requires the bundled
library to stay non-empty and complete in both languages, since a grep that
passes over an empty library proves nothing.

The library is _ours_, so it is translated like any other chrome and each
partner reads it in their own language. Manually entered ideas are the other
case — partner-authored, shown verbatim, and labelled with the language they
were written in when that differs from the reader's.

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
