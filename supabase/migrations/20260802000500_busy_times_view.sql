-- When the couple is occupied, and nothing else.
--
-- Both apps need to know that a window is taken so they stop offering it. The
-- phone's own calendar answers that for most cases and answers it well — the
-- intimacy app writes only a neutral label, so a plan reaches the other app's
-- free/busy search already redacted, without a single row crossing the domain
-- boundary. Two cases it cannot answer:
--
--   * A partner who never granted calendar access sees no busy times at all.
--   * A `proposed` plan reaches no calendar. `BOOKED` in packages/cadence is
--     `['scheduled']` on purpose — a time nobody has agreed to should not
--     appear in a shared calendar or fire a reminder — so the one window most
--     worth protecting from a double-booking is the one nothing knows about.
--
-- Hence this view: starts and ends, for the caller's own couple, with every
-- other column left behind. There is deliberately no `domain` column. The apps
-- do not filter it out; it is not there to filter. A caller cannot learn which
-- app a block belongs to, what it is called, where it is, or who made it —
-- only that those hours are spoken for.
--
-- `security_invoker = on` is load-bearing. A view runs as its owner by
-- default, which here is `postgres`, and would sail straight past
-- `plans_select_member` and hand every couple's schedule to every caller.
-- With it, the existing policy on `plans` applies to the caller as it always
-- has, and this view narrows what they can read rather than widening it.
--
-- Note this is not a boundary between the two partners, and could not be: they
-- share the `authenticated` role, and both are legitimate members of the
-- couple. It is a boundary between the two *apps*, and it is the same argument
-- packages/data/src/repository.ts makes — enforced here in Postgres rather
-- than by a caller remembering to select fewer columns.

create view public.plan_busy_times
with (security_invoker = on) as
select
  couple_id,
  starts_at,
  ends_at
from public.plans
where starts_at is not null
  and ends_at is not null
  -- 'completed' and 'skipped' are in the past; 'idea' and 'declined' were
  -- never a commitment. Only these two occupy time that is still ahead.
  and status in ('proposed', 'scheduled');

comment on view public.plan_busy_times is
  'Occupied windows for the caller''s couple, times only. Deliberately carries no domain, title, notes or location — see packages/data/src/busy.ts.';

-- `alter default privileges ... revoke all on tables from anon` in the
-- data-protection migration already covers this, but the revoke is stated
-- explicitly the way every other object in this schema states it, so the
-- access surface stays readable without cross-referencing.
revoke all on public.plan_busy_times from anon;

-- Nothing is granted implicitly: the default ACL on this project hands out no
-- SELECT, and `auto_expose_new_tables` is off in config.toml. Without this
-- line the view exists and is unreadable. Select only — a view over `plans`
-- would be auto-updatable, and there is no reason on earth to write through it.
grant select on public.plan_busy_times to authenticated;
