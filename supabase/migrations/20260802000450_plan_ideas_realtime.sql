-- Stream `plan_ideas` to both devices.
--
-- The publication list was written in `20260801000300_intimacy_checkins.sql`,
-- which predates the 2-2-2 tables entirely — so `plan_ideas` was left out by
-- ordering accident rather than by decision. The effect was that the shortlist
-- was the one shared list in either app that did not update live: an idea one
-- partner saved sat invisible on the other's device until something unrelated
-- forced a refetch. That is precisely when it matters, since the two of them
-- are reading the same shortlist while deciding what to book.
--
-- Publishing a table does not widen who can read it. Realtime still evaluates
-- RLS per subscriber, so `plan_ideas_select_member` remains what keeps a
-- couple's shortlist from reaching anyone outside that couple.

alter publication supabase_realtime add table public.plan_ideas;

-- `ai_usage` is deliberately not published. It is a rate-limit counter with no
-- UI that reacts to it, and per the no-streaks-no-scores rule it should not
-- grow one: a live-updating count of anything is a scoreboard waiting to
-- happen.
