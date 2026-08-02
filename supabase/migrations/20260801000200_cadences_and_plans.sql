-- Cadences and plans: the shared vocabulary both apps schedule against.
--
-- `domain` namespaces each app ('intimacy', 'two_two_two') and `kind` names a
-- ritual within it ('date_night', 'extended'). Both are text with a slug
-- check rather than enums, on purpose: the cadence engine treats `kind` as an
-- opaque token, so adding a ritual — or a third app — is a TypeScript constant
-- and two translation keys, never a migration. The catalogs live in
-- `packages/core/src/kinds.ts`.

create type public.interval_unit as enum ('day', 'week', 'month', 'year');

create type public.plan_status as enum (
  'idea',
  'proposed',
  'scheduled',
  'completed',
  'skipped',
  'declined'
);

create type public.proposal_response as enum (
  'pending',
  'accepted',
  'declined',
  'countered'
);

create domain public.slug as text
  check (value ~ '^[a-z][a-z0-9_]{0,62}$');

create table public.cadences (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  domain public.slug not null,
  kind public.slug not null,
  interval_value integer not null check (interval_value between 1 and 365),
  interval_unit public.interval_unit not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (couple_id, domain, kind)
);

create trigger cadences_touch_updated_at
  before update on public.cadences
  for each row execute function public.touch_updated_at();

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  domain public.slug not null,
  kind public.slug not null,
  -- Title, notes and location, sealed on the device that wrote them. Still
  -- partner-authored text displayed verbatim in whatever language it was
  -- written and never machine-translated — that has not changed. What has
  -- changed is that nothing outside the two phones can read it.
  --
  -- One blob rather than three columns, and not to save space: with a column
  -- each, `notes is null` would tell anyone reading this table whether a note
  -- exists on every plan in it, which for this product is close to the
  -- interesting part. The format and what its AAD binds to are in
  -- packages/crypto/src/cipher.ts.
  payload text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.plan_status not null default 'idea',
  created_by uuid not null references public.profiles (id) on delete cascade,
  completed_at timestamptz,
  -- profile_id -> device calendar event id. Each partner's phone returns its
  -- own identifier for the same logical event, so this cannot be one column.
  calendar_event_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_window_ordered
    check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint plans_scheduled_needs_time
    check (status <> 'scheduled' or starts_at is not null),
  constraint plans_payload_format check (payload ~ '^[A-Za-z0-9+/]+={0,2}$'),
  -- The old per-field length limits (title 200, notes 4000, location 200) are
  -- enforced client-side now, before sealing. This is only a ceiling on how
  -- much can be parked in the column.
  constraint plans_payload_bounded check (length(payload) between 64 and 24000)
);

-- Lets plan_proposals carry a denormalized couple_id that Postgres itself
-- keeps consistent, so RLS reads one column instead of joining on every row.
alter table public.plans
  add constraint plans_id_couple_key unique (id, couple_id);

create trigger plans_touch_updated_at
  before update on public.plans
  for each row execute function public.touch_updated_at();

create index plans_couple_domain_status_idx
  on public.plans (couple_id, domain, kind, status);

create index plans_couple_starts_at_idx
  on public.plans (couple_id, starts_at desc nulls last);

create table public.plan_proposals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  couple_id uuid not null,
  proposed_by uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  response public.proposal_response not null default 'pending',
  responded_at timestamptz,
  responded_by uuid references public.profiles (id) on delete set null,
  -- Set when this is a counter-offer, forming a chain back through the
  -- negotiation.
  countered_from uuid references public.plan_proposals (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_proposals_window_ordered check (ends_at > starts_at),
  constraint plan_proposals_plan_fk
    foreign key (plan_id, couple_id)
    references public.plans (id, couple_id) on delete cascade
);

create trigger plan_proposals_touch_updated_at
  before update on public.plan_proposals
  for each row execute function public.touch_updated_at();

create index plan_proposals_plan_idx on public.plan_proposals (plan_id, created_at desc);
create index plan_proposals_pending_idx
  on public.plan_proposals (couple_id, response)
  where response = 'pending';

-- You cannot answer your own proposal. The whole point is that the other
-- person gets to say no.
create or replace function public.enforce_proposal_responder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.response <> 'pending' and old.response = 'pending' then
    if new.responded_by is null then
      new.responded_by := (select auth.uid());
    end if;
    if new.responded_by = new.proposed_by then
      raise exception 'a proposal must be answered by the other partner'
        using errcode = '42501';
    end if;
    if new.responded_at is null then
      new.responded_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger plan_proposals_check_responder
  before update on public.plan_proposals
  for each row execute function public.enforce_proposal_responder();
