-- Chore creation was failing outright: chores.created_by is NOT NULL with no
-- default, and nothing on the client sets it. Every insert from ChoreForm ->
-- useUpsertChore came back 400:
--
--   null value in column "created_by" of relation "chores"
--   violates not-null constraint
--
-- Defaulting to auth.uid() fixes it for every insert path at once, rather than
-- relying on each caller to remember the column. Matches how create_household()
-- already stamps households.created_by from auth.uid().
--
-- Note this is a default, not an enforcement: the RLS insert policy still gates
-- on household membership only, so a client could still pass an explicit
-- created_by. That was already true before this change.

alter table public.chores
  alter column created_by set default auth.uid();
