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

-- Granted to the connecting user rather than to `postgres`: Supabase and CI's
-- postgres service both log in as `postgres`, but a Homebrew cluster names its
-- superuser after the OS user and has no `postgres` role at all. Hardcoding it
-- made "or any plain Postgres 16" untrue.
grant anon to current_user;
grant authenticated to current_user;
grant service_role to current_user;

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

-- Supabase's default grants.
--
-- This block used to `grant all on tables` by default, on the belief that both
-- roles start with full table privileges and RLS is what restricts them. That
-- is no longer true, and the suite was quietly the more permissive of the two:
-- on a current Supabase image the default ACL for tables created by `postgres`
-- in `public` is `Dxtm` — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — with no
-- SELECT/INSERT/UPDATE/DELETE at all.
--
-- Granting `all` here meant every policy test passed against privileges the
-- real project does not hand out, and the app got 42501 on its first query
-- after sign-in while 43 tests stayed green. The schema now grants what it
-- needs explicitly, in 20260802000300_table_grants.sql, and this file
-- reproduces the real starting point so that migration is actually load-bearing
-- rather than decorative.
--
-- Functions keep their default grant: `execute` is public by default in
-- Postgres, which is why the migrations bother to revoke it before granting
-- execute to `authenticated`.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant truncate, references, trigger on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
