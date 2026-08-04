-- Check-ins: intimacy-app-owned.
--
-- One tap per person per day. This table is the reason the domain boundary
-- between the two apps matters — the 2-2-2 app never queries it, and
-- `packages/data` exposes no accessor that would let it.
--
-- Deliberately not a streak. There is no counter to break and nothing to
-- restart, because an app that turns "not tonight" into a broken chain is an
-- app that makes the problem worse.

-- There is no `checkin_interest` enum here any more, and its absence is the
-- point. `yes` / `maybe` / `not_tonight` is the single most revealing value in
-- this schema, and an enum column would have published it in the clear for
-- every check-in ever made. It is a machine token inside the payload now,
-- rendered through a translation key exactly as before — the rule about never
-- storing a display string is unchanged, it simply applies inside the blob.

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- The calendar date as the couple reads it, in their timezone. Stored as a
  -- date rather than a timestamp so "today" means the same thing to both
  -- partners regardless of who is awake.
  --
  -- Left readable, deliberately: the one-per-person-per-day rule below is a
  -- unique constraint on it, and the couple's own screens filter by it. So a
  -- reader of this table learns which days each partner checked in, and
  -- nothing whatsoever about what they said.
  on_date date not null,
  -- interest, energy and the note.
  payload text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, on_date),
  constraint checkins_payload_format check (payload ~ '^[A-Za-z0-9+/]+={0,2}$'),
  constraint checkins_payload_bounded check (length(payload) between 64 and 4000)
);

create trigger checkins_touch_updated_at
  before update on public.checkins
  for each row execute function public.touch_updated_at();

create index checkins_couple_date_idx on public.checkins (couple_id, on_date desc);

-- Live updates for the propose/respond loop and the day's check-in state.
alter publication supabase_realtime add table public.plans;
alter publication supabase_realtime add table public.plan_proposals;
alter publication supabase_realtime add table public.checkins;
