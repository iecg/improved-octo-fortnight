-- Minimum Supabase surface needed to apply and exercise our migrations on a
-- plain Postgres instance.
--
-- `supabase start` is the real thing and needs Docker. This shim exists so the
-- security-critical RLS suite can also run in CI and in containers where
-- Docker is unavailable — the policies are the part that must never regress
-- unnoticed, so they should not be the part gated behind the heaviest
-- dependency.
--
-- It reproduces only what the migrations touch: the roles, the auth schema,
-- auth.uid(), the realtime publication, and Supabase's default grants.

-- Roles are cluster-wide, not per-database, so re-running the harness against
-- the same cluster must not trip over roles an earlier run created.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant anon to postgres;
grant authenticated to postgres;
grant service_role to postgres;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase: the subject claim of the request's JWT, or null when
-- unauthenticated. Tests set it with `set local request.jwt.claim.sub`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

create publication supabase_realtime;

-- Supabase's default grants: both roles start with full table privileges and
-- RLS is what actually restricts them. Our migrations then narrow this
-- (revoking from anon, and reducing couples to a column-level update grant),
-- so the starting point has to match or those statements would be testing
-- nothing.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
