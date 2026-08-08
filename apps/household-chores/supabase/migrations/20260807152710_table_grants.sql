-- Table-level privileges for the `authenticated` role.
--
-- RLS policies only *filter* rows -- they do not confer privileges. Current
-- Supabase images ship a secure-by-default `public` schema whose default ACL
-- grants anon/authenticated only Dxtm (truncate/references/trigger/maintain),
-- so without these grants every policy above is dead and the API returns
-- 42501 "permission denied" for every table.
--
-- Each grant below mirrors exactly the policies defined in
-- 20260807152703_rls_and_rpcs.sql -- nothing broader. `anon` is deliberately
-- omitted: no table has a policy for it, so it stays locked out.

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
grant select, update on public.households to authenticated;
grant select, delete on public.household_members to authenticated;
grant select, insert, update, delete on public.chores to authenticated;
grant select on public.chore_rotation_state to authenticated;
grant select, update on public.chore_instances to authenticated;
