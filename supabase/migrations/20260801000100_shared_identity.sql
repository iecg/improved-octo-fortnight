-- Shared identity: the people, the couple, and the pairing between them.
--
-- Every app in this repo reads these tables. Pairing happens once and serves
-- all of them, so installing the second app never asks the couple to link up
-- again.
--
-- Security-definer functions run with `search_path = ''` and fully qualify
-- every reference, so a table shadowed in a caller's search path cannot be
-- used to redirect them.

create type public.locale as enum ('en', 'es');

-- Keeps `updated_at` honest without trusting clients to send it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- The display name, sealed on the device that set it under the couple's
  -- `shared` content key. Null until pairing, and not because of an ordering
  -- accident: before there is a couple there is no key to seal it with, and no
  -- partner to address either. A name shown only to yourself is a device
  -- preference, not a row.
  --
  -- The length rule that used to live here (1..80 characters) is now enforced
  -- client-side before sealing. That moves an integrity check off the server,
  -- and it is worth being plain about — though the only party it ever protected
  -- against was the couple themselves, since RLS already confines writes to
  -- their own rows.
  name_payload text,
  timezone text not null default 'UTC',
  -- Locale is per person, not per couple: partners read the same rows in
  -- different languages.
  locale public.locale not null default 'en',
  expo_push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_payload_format
    check (name_payload is null or name_payload ~ '^[A-Za-z0-9+/]+={0,2}$'),
  -- A ceiling rather than a measurement: it stops the column being used as
  -- general blob storage. What actually validates a payload is its Poly1305
  -- tag, and only a device holding the key can check that.
  constraint profiles_name_payload_bounded
    check (name_payload is null or length(name_payload) between 64 and 1000)
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A profile row for every auth user, created server-side so the client never
-- has to remember to.
--
-- The row is empty apart from its id. An earlier version copied a display name
-- out of `raw_user_meta_data`, which was leakage rather than convenience: the
-- server already holds that metadata in `auth.users`, and copying it into a
-- table meant to be end-to-end encrypted would have made it the one plaintext
-- hole in it. The name arrives later, sealed, once there is a couple key.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  anniversary_date date,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger couples_touch_updated_at
  before update on public.couples
  for each row execute function public.touch_updated_at();

create table public.couple_members (
  couple_id uuid not null references public.couples (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, profile_id)
);

-- One couple per person. Leaving means deleting the row.
create unique index couple_members_one_couple_per_profile
  on public.couple_members (profile_id);

-- Belt and braces alongside the check inside join_couple: a couple is two
-- people, and nothing should be able to make it three.
create or replace function public.enforce_couple_size()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.couple_members where couple_id = new.couple_id) >= 2 then
    raise exception 'a couple has at most two members' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger couple_members_max_two
  before insert on public.couple_members
  for each row execute function public.enforce_couple_size();

-- The membership predicate every RLS policy is built from.
create or replace function public.is_couple_member(target uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.couple_members
    where couple_id = target
      and profile_id = (select auth.uid())
  );
$$;

-- The couple the caller belongs to, or null. Convenient in policies and saves
-- the client from passing an id it could lie about.
create or replace function public.current_couple_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select couple_id
  from public.couple_members
  where profile_id = (select auth.uid())
  limit 1;
$$;

-- Ambiguous glyphs (I, L, O, 0, 1) are omitted: this code gets read aloud and
-- typed from a screenshot.
create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i integer;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.couples where invite_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.create_couple(p_timezone text default 'UTC')
returns public.couples
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_couple public.couples;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if exists (select 1 from public.couple_members where profile_id = (select auth.uid())) then
    raise exception 'already paired' using errcode = '23505';
  end if;

  insert into public.couples (invite_code, timezone)
  values (public.generate_invite_code(), coalesce(nullif(trim(p_timezone), ''), 'UTC'))
  returning * into v_couple;

  insert into public.couple_members (couple_id, profile_id)
  values (v_couple.id, (select auth.uid()));

  return v_couple;
end;
$$;

-- Pairing is an RPC rather than a client insert so invite codes are never
-- exposed to enumeration through the table API: without this, anyone could
-- select over `couples` looking for a code that matched.
create or replace function public.join_couple(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_couple_id uuid;
  v_members integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if exists (select 1 from public.couple_members where profile_id = (select auth.uid())) then
    raise exception 'already paired' using errcode = '23505';
  end if;

  -- `for update` serializes two people redeeming the same code at once.
  select id into v_couple_id
  from public.couples
  where invite_code = upper(trim(p_code))
  for update;

  if v_couple_id is null then
    raise exception 'invalid invite code' using errcode = '22023';
  end if;

  select count(*) into v_members
  from public.couple_members
  where couple_id = v_couple_id;

  if v_members >= 2 then
    raise exception 'couple is full' using errcode = '23514';
  end if;

  insert into public.couple_members (couple_id, profile_id)
  values (v_couple_id, (select auth.uid()));

  -- The code has done its job. Rotating it means a forwarded link or a
  -- screenshot in a camera roll cannot be replayed by a third person.
  update public.couples
  set invite_code = public.generate_invite_code()
  where id = v_couple_id;

  return v_couple_id;
end;
$$;

revoke all on function public.create_couple(text) from public;
revoke all on function public.join_couple(text) from public;
revoke all on function public.generate_invite_code() from public;
grant execute on function public.create_couple(text) to authenticated;
grant execute on function public.join_couple(text) to authenticated;
