-- Where a 2-2-2 outing actually happens.
--
-- A separate table rather than columns on `plans`, deliberately. `plans` is
-- shared with the intimacy app and is in the realtime publication: coordinates
-- there would replicate to an app that has no use for them, and `toPlan` would
-- grow four fields that are null for every intimacy row forever. This table is
-- 2-2-2-owned in the same way `plan_ideas` is, reached only through its own
-- factory in `packages/data/src/places.ts`.
--
-- `plans.location` keeps doing what it always did: hold the human label, which
-- is the value that can reach a device calendar. The machine reference
-- (`provider_place_id`, coordinates) lives only here. Two columns, two
-- different privacy stories, on purpose — the calendar sees a label a partner
-- opted into, never a coordinate.
--
-- Nothing here needs a mapping provider. A place typed by hand is
-- `provider = 'manual'` with no coordinates, and every feature downstream
-- treats a missing coordinate as "no travel time, no map" rather than an error.
-- That is what makes the whole feature work with no API key configured.

-- Lets plan_places carry a denormalized couple_id that Postgres itself keeps
-- honest, the same composite-foreign-key trick plan_proposals already uses
-- against plans. Without it a client could attach a place to another couple's
-- idea by guessing an id.
alter table public.plan_ideas
  add constraint plan_ideas_id_couple_key unique (id, couple_id);

create table public.plan_places (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  domain public.slug not null,

  -- Exactly one target. A place hangs off the plan it is for, or off the idea
  -- that has not been booked yet.
  plan_id uuid,
  idea_id uuid,

  -- Shown verbatim. Either a partner's typing or a provider's own record;
  -- never machine-translated, exactly like an idea's title.
  name text not null check (length(name) between 1 and 200),
  address text check (address is null or length(address) <= 300),

  -- 'manual' is a partner typing a name. It is the only provider that exists
  -- with nothing configured, and it stays a first-class case everywhere.
  provider text not null check (provider in ('manual', 'google')),
  -- The provider's opaque handle. Nothing is derived from it locally; it is
  -- what a later lookup would use to refresh a stale address.
  provider_place_id text check (provider_place_id is null or length(provider_place_id) <= 255),

  -- Null whenever the place was typed rather than searched, which is the
  -- normal case.
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),

  -- The language the address is written in. Labelled, not translated — the
  -- same rule as plan_ideas.locale. A venue's NAME is a proper noun and is
  -- never labelled; only the address line is.
  locale public.locale not null,

  -- Off by default. A calendar entry is visible to anyone holding an unlocked
  -- phone and syncs to a shared desktop, so an address goes there only because
  -- someone asked for it.
  share_with_calendar boolean not null default false,

  attached_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plan_places_one_target
    check ((plan_id is null) <> (idea_id is null)),
  -- Half a coordinate is not a location.
  constraint plan_places_coords_paired
    check ((latitude is null) = (longitude is null)),
  constraint plan_places_google_has_id
    check (provider <> 'google' or provider_place_id is not null),
  constraint plan_places_plan_fk
    foreign key (plan_id, couple_id)
    references public.plans (id, couple_id) on delete cascade,
  constraint plan_places_idea_fk
    foreign key (idea_id, couple_id)
    references public.plan_ideas (id, couple_id) on delete cascade
);

create unique index plan_places_one_per_plan
  on public.plan_places (plan_id) where plan_id is not null;
create unique index plan_places_one_per_idea
  on public.plan_places (idea_id) where idea_id is not null;
create index plan_places_couple_idx on public.plan_places (couple_id, domain);

create trigger plan_places_touch_updated_at
  before update on public.plan_places
  for each row execute function public.touch_updated_at();

alter table public.plan_places enable row level security;

create policy plan_places_select_member on public.plan_places
  for select to authenticated
  using (public.is_couple_member(couple_id));

create policy plan_places_insert_member on public.plan_places
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and attached_by = (select auth.uid()));

-- Either partner may correct or remove a place on a shared plan; that is the
-- point of a shared plan.
create policy plan_places_update_member on public.plan_places
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

create policy plan_places_delete_member on public.plan_places
  for delete to authenticated
  using (public.is_couple_member(couple_id));

-- Privileges live beside the policies, matching plan_ideas rather than the
-- already-applied 20260802000300_table_grants.sql. Same shape as the policies
-- above: two locks, one outline.
revoke all on public.plan_places from anon;
grant select, insert, update, delete on public.plan_places to authenticated;

-- Deliberately NOT added to the supabase_realtime publication. Attaching a
-- place also writes plans.location, which already fires the plans channel that
-- useRealtimeSync listens to. That is the tripwire; coordinates never
-- replicate.
