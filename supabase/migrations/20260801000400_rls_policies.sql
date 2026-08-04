-- Row Level Security.
--
-- Every policy for the tables that existed when this was written lives here, so
-- the shared access surface reads top to bottom in a review. Tables added later
-- carry their own policies beside their own `create table` — `plan_ideas` and
-- `ai_usage` in `20260802000200_two_two_two_ideas.sql`. Do not assume this file
-- is the whole surface; `tests/rls/policies.test.ts` is what enumerates it.
--
-- The shape repeats deliberately:
--
--   read/write  -> public.is_couple_member(couple_id)
--   authorship  -> the acting column must equal auth.uid()
--
-- `auth.uid()` is wrapped in `(select ...)` throughout so Postgres evaluates it
-- once per statement as an initplan rather than once per row.
--
-- What RLS cannot express, and is therefore enforced in `packages/data`: the
-- boundary between the two apps. Both partners are legitimate members of the
-- couple, so the database has no basis to hide `domain = 'intimacy'` rows from
-- the 2-2-2 app. That is a query-layer invariant — every accessor is
-- domain-scoped and no raw table client is exported.

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.cadences enable row level security;
alter table public.plans enable row level security;
alter table public.plan_proposals enable row level security;
alter table public.checkins enable row level security;

-- Nothing in this schema is public.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------- profiles

-- You can see yourself and the person you are paired with — the partner's
-- display name and locale are needed to address them and to know that they
-- read in another language.
create policy profiles_select_self_or_partner on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.couple_members
      where couple_id = public.current_couple_id()
        and profile_id = public.profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Rows are created by the on_auth_user_created trigger; clients never insert
-- or delete them.

-- ----------------------------------------------------------------- couples

create policy couples_select_member on public.couples
  for select to authenticated
  using (public.is_couple_member(id));

create policy couples_update_member on public.couples
  for update to authenticated
  using (public.is_couple_member(id))
  with check (public.is_couple_member(id));

-- Column-level grant: a member may set the couple's timezone and anniversary,
-- but not choose their own invite code. Creation goes through create_couple().
revoke update on public.couples from authenticated;
grant update (anniversary_date, timezone) on public.couples to authenticated;

-- ---------------------------------------------------------- couple_members

create policy couple_members_select_member on public.couple_members
  for select to authenticated
  using (public.is_couple_member(couple_id));

-- Leaving is allowed; adding someone is not. Insertion happens only inside
-- create_couple() and join_couple(), which check the invite code and the
-- two-person cap.
create policy couple_members_delete_self on public.couple_members
  for delete to authenticated
  using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------- cadences

create policy cadences_select_member on public.cadences
  for select to authenticated
  using (public.is_couple_member(couple_id));

create policy cadences_insert_member on public.cadences
  for insert to authenticated
  with check (public.is_couple_member(couple_id));

create policy cadences_update_member on public.cadences
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

create policy cadences_delete_member on public.cadences
  for delete to authenticated
  using (public.is_couple_member(couple_id));

-- ------------------------------------------------------------------- plans

create policy plans_select_member on public.plans
  for select to authenticated
  using (public.is_couple_member(couple_id));

create policy plans_insert_member on public.plans
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and created_by = (select auth.uid()));

-- Either partner may edit or complete a shared plan; that is the point of a
-- shared plan.
create policy plans_update_member on public.plans
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

create policy plans_delete_member on public.plans
  for delete to authenticated
  using (public.is_couple_member(couple_id));

-- ---------------------------------------------------------- plan_proposals

create policy plan_proposals_select_member on public.plan_proposals
  for select to authenticated
  using (public.is_couple_member(couple_id));

create policy plan_proposals_insert_own on public.plan_proposals
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and proposed_by = (select auth.uid()));

-- Responding is an update. The enforce_proposal_responder trigger rejects
-- answering your own proposal.
create policy plan_proposals_update_member on public.plan_proposals
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

create policy plan_proposals_delete_own on public.plan_proposals
  for delete to authenticated
  using (proposed_by = (select auth.uid()));

-- ---------------------------------------------------------------- checkins

-- Both partners see both check-ins — that is what makes them useful.
create policy checkins_select_member on public.checkins
  for select to authenticated
  using (public.is_couple_member(couple_id));

-- But nobody answers on anyone else's behalf.
create policy checkins_insert_own on public.checkins
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and profile_id = (select auth.uid()));

create policy checkins_update_own on public.checkins
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy checkins_delete_own on public.checkins
  for delete to authenticated
  using (profile_id = (select auth.uid()));
