-- Stream check-in deletions to both devices.
--
-- Clearing a check-in is a hard delete. The realtime subscription filters
-- `checkins` on `couple_id`, but under the default (primary-key) replica
-- identity a DELETE event carries only the id, so the couple filter can never
-- match and the delete never reaches the partner's phone — the row would
-- vanish on one device and linger on the other until a refetch.
--
-- `replica identity full` puts the whole old row, `couple_id` included, in the
-- delete payload, so the subscription already on `checkins` delivers it. No new
-- table, no new subscription, no publication change.

alter table public.checkins replica identity full;
