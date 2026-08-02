-- Table privileges.
--
-- RLS decides which *rows* a caller may touch. It never grants the right to
-- touch the table at all — that is a plain SQL privilege, and without it
-- PostgREST answers 42501 "permission denied for table ..." before a policy is
-- ever consulted.
--
-- Everything here was previously left to Supabase's default privileges. It no
-- longer works to rely on them: on a current Supabase image the default ACL for
-- tables created by `postgres` in `public` is `Dxtm` — TRUNCATE, REFERENCES,
-- TRIGGER, MAINTAIN — and pointedly not SELECT/INSERT/UPDATE/DELETE. So every
-- table in this schema was unreadable by the app, the RPCs being the only thing
-- that worked (a SECURITY DEFINER function runs as its owner and needs no grant
-- from the caller). Sign in, and the first query fails.
--
-- This was invisible until the app ran against a real Supabase stack, because
-- `tests/rls/supabase-shim.sql` granted `all` by default and was therefore more
-- permissive than the thing it stands in for. The shim has been corrected to
-- match, so this file is now what the RLS suite exercises.
--
-- Written as its own migration rather than folded into the RLS one so it
-- replays cleanly against a database that already has the others.
--
-- The grants are deliberately narrower than the blanket `all` Supabase used to
-- hand out — each one mirrors the policies that exist for that table, so a
-- table with no insert policy also has no insert privilege. Two locks, same
-- shape.

-- Reading and writing rows requires reaching the schema first.
grant usage on schema public to authenticated;

-- ---------------------------------------------------------------- profiles
-- Select self or partner; update self. Rows are created by the
-- on_auth_user_created trigger and deleted with the auth user, so the client
-- needs neither insert nor delete.
grant select, update on public.profiles to authenticated;

-- ----------------------------------------------------------------- couples
-- Creation goes through create_couple(). The update privilege is deliberately
-- *not* granted here: the RLS migration already narrowed it to
-- (anniversary_date, timezone) at column level, and a table-wide grant would
-- silently widen it back to include invite_code.
grant select on public.couples to authenticated;

-- ---------------------------------------------------------- couple_members
-- Leaving is allowed; adding someone is not — insertion happens only inside
-- create_couple() and join_couple().
grant select, delete on public.couple_members to authenticated;

-- ---------------------------------------------------- couple-owned content
grant select, insert, update, delete on public.cadences to authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant select, insert, update, delete on public.plan_proposals to authenticated;
grant select, insert, update, delete on public.checkins to authenticated;
grant select, insert, update, delete on public.plan_ideas to authenticated;

-- `ai_usage` already has exactly `select`, granted where it was created: only
-- a service role could increment it, and nothing does — suggestions are BYOK
-- and never touch a server of ours. `join_attempts` stays
-- unreachable — the security-definer RPC is its only caller.

-- Nothing changes for anon. It holds no privileges on this schema and the
-- earlier `revoke all ... from anon` stands.
