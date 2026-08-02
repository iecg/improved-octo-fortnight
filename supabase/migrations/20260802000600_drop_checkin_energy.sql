-- Drop `checkins.energy`.
--
-- It shipped with the table, was typed all the way through `RecordCheckinInput`
-- and `Checkin`, and was never written by anything: no screen collected it, and
-- the only value it has ever held is null. Dropping it loses no data.
--
-- It is worth removing rather than leaving as harmless dead weight, because of
-- what it is: a 1-5 self-rating. Invariant 4 says no streaks and no scores, and
-- a number between 1 and 5 attached to how someone felt about a night is the
-- exact shape of a score — the kind of column that acquires an average, then a
-- trend line, then a reason to feel bad about a Tuesday.
--
-- `interest` stays. It is three neutral tokens, rendered through translation
-- keys, with "not tonight" styled identically to "yes".

alter table public.checkins drop column energy;
