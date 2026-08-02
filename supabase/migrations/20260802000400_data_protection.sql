-- Data protection: what happens to a couple's data when a member leaves, and
-- who is allowed to rewrite the record of who did what.
--
-- Five changes. The first two close ways a stranger reaches a couple's history;
-- the third and fourth close ways one partner forges the other's consent; the
-- fifth removes a credential the app never used.
--
-- Each is backed by a test in `tests/rls/policies.test.ts`, and each was
-- reproduced against the migrations as they stood before this file.

-- ---------------------------------------------------------------------------
-- 1. A couple with no members left is deleted, not abandoned.
--
-- Leaving is `delete from couple_members`, and nothing followed it. When the
-- last member left, the couple row survived with every plan, proposal,
-- check-in and note still attached — and with a redeemable invite code, since
-- rotation only ever happened on join. `join_couple` admits anyone while the
-- member count is under two, so redeeming that code made a stranger a member
-- of a couple that no longer had any, with full read access to all of it.
--
-- Nobody can reach an empty couple's rows through any policy, so there is no
-- one left for the retention to serve. Deleting cascades to every table keyed
-- on couple_id.
--
-- 2. Losing a member rotates the invite code.
--
-- The rotation on join was already justified in the pairing-hardening
-- migration by the fact that "leaving a couple reopens the slot" — but it was
-- only wired to join. A code that circulated while the couple was full (a
-- screenshot, a forwarded message) went live again the moment either partner
-- left, and the free slot went to whoever redeemed it first. Rotating here is
-- what makes that sentence true.
-- ---------------------------------------------------------------------------

create or replace function public.handle_member_departure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  select count(*) into v_remaining
  from public.couple_members
  where couple_id = old.couple_id;

  if v_remaining = 0 then
    -- No recursion: the cascade back onto couple_members has no rows to find.
    delete from public.couples where id = old.couple_id;
  else
    update public.couples
    set invite_code = public.generate_invite_code()
    where id = old.couple_id;
  end if;

  return null;
end;
$$;

-- Fires for a partner leaving and for a cascade from a deleted profile alike;
-- both are a member the couple no longer has.
create trigger couple_members_handle_departure
  after delete on public.couple_members
  for each row execute function public.handle_member_departure();

-- ---------------------------------------------------------------------------
-- 3. Authorship columns cannot be rewritten after insert.
--
-- Every authorship rule in the RLS migration is an insert-time `with check`:
-- `created_by = auth.uid()`, `saved_by = auth.uid()`, `profile_id =
-- auth.uid()`. The matching update policies check only membership, so each of
-- those pins was one UPDATE away from meaningless — a partner could reattribute
-- their own row to the other person, or the other person's row to themselves.
--
-- `couple_id` is pinned for the same reason: a row's couple is what every
-- policy in the schema reasons about, and it is not something an edit changes.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  col text;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  foreach col in array tg_argv loop
    -- A transition to null is allowed, and only because `on delete set null`
    -- on the authorship foreign keys performs exactly this update when a
    -- profile is deleted: refusing it would make deleting an account fail.
    -- Dropping your own attribution loses information. It cannot forge anyone
    -- else's, which is what this guard is for.
    if old_row -> col is distinct from new_row -> col
      and jsonb_typeof(new_row -> col) <> 'null'
    then
      raise exception '%.% cannot be changed after insert', tg_table_name, col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

create trigger cadences_immutable_identity
  before update on public.cadences
  for each row execute function public.enforce_immutable_columns('couple_id');

create trigger plans_immutable_authorship
  before update on public.plans
  for each row execute function public.enforce_immutable_columns('couple_id', 'created_by');

create trigger plan_proposals_immutable_authorship
  before update on public.plan_proposals
  for each row
  execute function public.enforce_immutable_columns('couple_id', 'plan_id', 'proposed_by');

create trigger checkins_immutable_authorship
  before update on public.checkins
  for each row execute function public.enforce_immutable_columns('couple_id', 'profile_id');

create trigger plan_ideas_immutable_authorship
  before update on public.plan_ideas
  for each row execute function public.enforce_immutable_columns('couple_id', 'saved_by');

-- ---------------------------------------------------------------------------
-- 4. The responder is whoever is making the update.
--
-- "You cannot answer your own proposal" is the rule this schema describes as
-- the whole point of a proposal, and it compared two columns the caller
-- controlled in the same statement. Both sides of that comparison were
-- forgeable, independently:
--
--   update plan_proposals set proposed_by = <partner>, response = 'accepted'
--   update plan_proposals set responded_by = <partner>, response = 'accepted'
--
-- Either one let the proposer accept their own proposal, and left a row
-- claiming the partner had agreed to a time they had never seen. The first is
-- closed by the immutability trigger above; the second is closed here, by
-- taking the responder from `auth.uid()` unconditionally instead of honouring
-- what the client sent. Comparing against `old.proposed_by` rather than
-- `new.proposed_by` means this holds on its own, without depending on the
-- other trigger firing first.
--
-- Rewriting a proposal that has *already* been answered stays permitted, as
-- pinned by `tests/e2e/journey.test.ts`. That decision is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_proposal_responder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.response is distinct from old.response and old.response = 'pending' then
    new.responded_by := (select auth.uid());
    new.responded_at := now();

    if new.responded_by = old.proposed_by then
      raise exception 'a proposal must be answered by the other partner'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Drop the push token.
--
-- `profiles.expo_push_token` was carried since the first migration and never
-- written: no app calls `setPushToken`, because reminders in this product are
-- local, composed on the recipient's own device. What the column did do was
-- sit inside `profiles`, which a partner can read in full — and an Expo push
-- token is a bearer credential. Anyone holding one can post arbitrary text to
-- that device's lock screen through a public endpoint that asks for no
-- authentication.
--
-- So it was a standing way to defeat the discretion invariant, kept for a
-- feature that does not exist. Column-level privileges cannot help: they are
-- per role, and self and partner are the same role. Storing it elsewhere would
-- mean designing a home for a value nothing produces.
--
-- If push is ever wanted, it needs its own table, owner-only policies, and a
-- reason to override "nothing intimate reaches a lock screen".
-- ---------------------------------------------------------------------------

alter table public.profiles drop column expo_push_token;

-- With the token gone the client writes exactly three fields, so the grant may
-- say so — the same column-level narrowing `couples` already uses, and the
-- reason is the same: a table-wide grant silently widens to whatever columns
-- get added later.
revoke update on public.profiles from authenticated;
grant update (display_name, locale, timezone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping: `revoke all ... from anon` in the RLS migration was a
-- statement about the tables that existed when it ran. Tables added afterwards
-- got Supabase's defaults back, and each has needed its own revoke since. This
-- makes the default the revoke.
-- ---------------------------------------------------------------------------

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
