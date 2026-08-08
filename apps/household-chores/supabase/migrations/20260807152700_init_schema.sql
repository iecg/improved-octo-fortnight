-- Household Chores: core schema
-- Tables: profiles, households, household_members, chores, chore_rotation_state,
-- chore_instances, push_tokens.

-- ---------------------------------------------------------------------------
-- profiles (mirrors auth.users; one row per user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Public profile data mirroring auth.users, auto-created on signup.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- push_tokens (one row per registered device)
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  device_id text,
  created_at timestamptz not null default now()
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  timezone text not null default 'UTC',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------
create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  "position" int not null,
  joined_at timestamptz not null default now(),
  unique (household_id, user_id),
  -- Redundant FK to profiles (profiles.id == auth.users.id, kept in sync by
  -- the trigger above) purely so PostgREST can embed `profiles(*)` when
  -- selecting household_members from the client.
  constraint household_members_user_id_profiles_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade
);

create index household_members_household_id_idx on public.household_members (household_id);
create index household_members_user_id_idx on public.household_members (user_id);

comment on column public.household_members."position" is
  'Stable join-order used to drive rotation assignment. Not derived from joined_at.';

-- ---------------------------------------------------------------------------
-- chores
-- ---------------------------------------------------------------------------
create type public.cadence_type as enum ('daily', 'weekly_days', 'every_n_days', 'monthly');
create type public.assignment_type as enum ('fixed', 'rotating');

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  description text,
  icon text,
  cadence_type public.cadence_type not null,
  cadence_config jsonb not null default '{}'::jsonb,
  start_date date not null default current_date,
  assignment_type public.assignment_type not null default 'rotating',
  fixed_assignee_id uuid references auth.users (id),
  active boolean not null default true,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint fixed_requires_assignee check (
    (assignment_type = 'fixed' and fixed_assignee_id is not null)
    or (assignment_type = 'rotating' and fixed_assignee_id is null)
  ),
  -- Redundant FK to profiles, same rationale as household_members above.
  constraint chores_fixed_assignee_id_profiles_fkey
    foreign key (fixed_assignee_id) references public.profiles (id)
);

create index chores_household_id_idx on public.chores (household_id) where active;

comment on column public.chores.cadence_config is
  'daily: {}; weekly_days: {"weekdays":[0-6]} (0=Sun); every_n_days: {"n": int}; monthly: {"day_of_month": int}.';

-- ---------------------------------------------------------------------------
-- chore_rotation_state (one row per rotating chore; advanced atomically)
-- ---------------------------------------------------------------------------
create table public.chore_rotation_state (
  chore_id uuid primary key references public.chores (id) on delete cascade,
  next_position int not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- chore_instances (materialized one row per due occurrence)
-- ---------------------------------------------------------------------------
create type public.instance_status as enum ('pending', 'completed', 'missed');

create table public.chore_instances (
  id uuid primary key default gen_random_uuid(),
  chore_id uuid not null references public.chores (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  due_date date not null,
  assigned_to uuid not null references auth.users (id),
  status public.instance_status not null default 'pending',
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  photo_path text,
  created_at timestamptz not null default now(),
  unique (chore_id, due_date),
  -- Redundant FKs to profiles, same rationale as household_members above.
  constraint chore_instances_assigned_to_profiles_fkey
    foreign key (assigned_to) references public.profiles (id),
  constraint chore_instances_completed_by_profiles_fkey
    foreign key (completed_by) references public.profiles (id)
);

create index chore_instances_household_date_idx on public.chore_instances (household_id, due_date);
create index chore_instances_assignee_date_idx on public.chore_instances (assigned_to, due_date);

comment on column public.chore_instances.photo_path is
  'Object path in the private chore-photos storage bucket, not a public URL.';
