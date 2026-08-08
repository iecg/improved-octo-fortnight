# Household Chores

A mobile app for splitting household chores across housemates, with configurable
cadences (daily, specific weekdays, every N days, monthly), automatic rotation or
fixed assignment per chore, a daily "what's due today" screen, and photo proof of
completion.

## Stack

- **Expo** (managed workflow) + **Expo Router** (file-based navigation), TypeScript
- **React Native Paper** — Material Design component library
- **Supabase** — Postgres, Auth, Storage, Row Level Security, Edge Functions
- **TanStack Query** — data fetching/caching against Supabase
- **react-hook-form** + **zod** — forms and validation
- **expo-notifications** — daily push reminders for chores due today

## Project structure

```
src/
  app/                 # Expo Router routes (file-based)
    (auth)/             # login, signup
    (onboarding)/        # create/join a household
    (app)/(tabs)/         # today, chores, household, profile
    (app)/chore-instance/  # photo-proof completion modal
    join/[code]           # public invite-link deep-link forwarder
  components/          # shared UI (ChoreCard, CadencePicker, PhotoCapture, ...)
  hooks/               # React Query hooks (useChores, useHousehold, ...)
  lib/                 # supabase client, cadence math, storage, notifications
  types/               # Database types (hand-authored, see below)

supabase/
  migrations/          # schema, RLS policies, RPCs, storage bucket, pg_cron
  functions/
    daily-notifications/ # scheduled Edge Function that sends push reminders
  seed.sql
```

## Getting started

### 1. Install dependencies

```
npm install
```

### 2. Set up Supabase

**Local development (recommended):**

```
npx supabase start
```

This spins up local Postgres/Auth/Storage/Studio in Docker and applies the
migrations in `supabase/migrations/`. Copy the API URL and anon key it prints
(or run `npx supabase status`) into a `.env` file:

```
cp .env.example .env
# fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
```

**Or, against a hosted Supabase project:** create a project, then run
`npx supabase link` and `npx supabase db push` to apply the migrations, and use
that project's URL/anon key in `.env`.

### 3. Run the app

```
npm start
```

Scan the QR code with **Expo Go** on a physical iOS or Android device — a
physical device matters here specifically because camera capture and push
notifications don't work reliably in simulators/emulators.

### 4. Create test accounts

Sign up 2-3 test accounts through the app's Signup screen, then create a
household and join it from a second account with the invite code, to exercise
rotation and shared visibility. See `supabase/seed.sql` for more on local
seeding.

## Testing

```
npm test
```

Runs Jest (via `jest-expo`) against `src/lib/cadence.ts` — the pure due-date
and rotation math that drives "what's due today," tested in isolation from
Postgres/network. The SQL copy of the same logic (`is_chore_due`,
`ensure_todays_instances` in `supabase/migrations/`) is the actual source of
truth used for instance generation; the two are kept in sync intentionally.

## Push notifications setup

Push notifications need an EAS project to mint push tokens:

```
npx eas init
```

Then deploy the notification Edge Function and wire up the hourly schedule:

```
npx supabase functions deploy daily-notifications
npx supabase secrets set --env-file .env   # if the function needs any secrets

# One-time, in the Supabase SQL editor (see the comment at the top of
# supabase/migrations/20260807152707_push_notifications_cron.sql):
select vault.create_secret('https://<project-ref>.functions.supabase.co', 'project_functions_url');
select vault.create_secret('<service-role-key>', 'service_role_key');
```

Until an EAS project is configured, `registerForPushNotificationsAsync()` no-ops
with a console warning rather than throwing, so the rest of the app works fine
without it.

## Database types

`src/types/database.types.ts` is hand-authored to mirror the SQL migrations
(including the `Relationships` metadata supabase-js needs for typed embedded
selects like `chores(*)` or `profiles(*)`). Once linked to a real Supabase
project, regenerate the authoritative version with:

```
npx supabase gen types typescript --linked > src/types/database.types.ts
```

and re-apply any manual additions (like the `CadenceConfig` union) if the
generator's shape differs.

## Notable MVP simplifications

- One household per user (joining a second household isn't exposed in the UI).
- Any household member can log a chore instance as complete, not just the
  assignee — supports logging a chore on a housemate's behalf.
- Photo proof is stored and shown to the household; there's no approval workflow.
- Invite links use a custom URL scheme (`choresapp://join/CODE`); HTTPS
  universal links are out of scope (they require owning a domain).
- If a household member leaves mid-rotation, the rotation index isn't
  fairness-remapped — acceptable drift for MVP.
