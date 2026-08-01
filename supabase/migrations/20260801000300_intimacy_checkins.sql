-- Check-ins: intimacy-app-owned.
--
-- One tap per person per day. This table is the reason the domain boundary
-- between the two apps matters — the 2-2-2 app never queries it, and
-- `packages/data` exposes no accessor that would let it.
--
-- Deliberately not a streak. There is no counter to break and nothing to
-- restart, because an app that turns "not tonight" into a broken chain is an
-- app that makes the problem worse.

create type public.checkin_interest as enum ('yes', 'maybe', 'not_tonight');

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- The calendar date as the couple reads it, in their timezone. Stored as a
  -- date rather than a timestamp so "today" means the same thing to both
  -- partners regardless of who is awake.
  on_date date not null,
  interest public.checkin_interest not null,
  energy smallint check (energy is null or energy between 1 and 5),
  -- Partner-authored, shown verbatim.
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, on_date)
);

create trigger checkins_touch_updated_at
  before update on public.checkins
  for each row execute function public.touch_updated_at();

create index checkins_couple_date_idx on public.checkins (couple_id, on_date desc);

-- Live updates for the propose/respond loop and the day's check-in state.
alter publication supabase_realtime add table public.plans;
alter publication supabase_realtime add table public.plan_proposals;
alter publication supabase_realtime add table public.checkins;
