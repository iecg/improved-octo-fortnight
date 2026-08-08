-- Stop the rotation counter from advancing on every call.
--
-- ensure_todays_instances() is deliberately called on every Today-screen load
-- (lazy generation fallback). But the rotating branch ran
--
--   update chore_rotation_state set next_position = next_position + 1 ...
--
-- unconditionally, before the guarded
--
--   insert into chore_instances ... on conflict (chore_id, due_date) do nothing
--
-- so a repeat call for a date whose instance already existed still burned a
-- rotation slot. Observed live: one generated instance per chore, but
-- next_position had reached 8 and 6 -- and because the parity had drifted, the
-- next day's chore was assigned back to the same member instead of rotating to
-- the next one. Members get silently skipped.
--
-- Skipping the whole loop body when the instance already exists makes it
-- idempotent per (chore, due_date), which is what the on-conflict insert
-- already assumed.
--
-- ponytail: concurrent calls for the same date can still both pass this check
-- and double-advance. The instance insert stays correct either way (on
-- conflict), and lazy generation is not a hot path; take an advisory lock on
-- chore_id if that ever matters.

create or replace function public.ensure_todays_instances(
  p_household_id uuid,
  p_for_date date default current_date
)
returns setof public.chore_instances
language plpgsql
security definer
set search_path = public
as $$
declare
  r_chore public.chores;
  v_members uuid[];
  v_member_count int;
  v_idx int;
  v_assignee uuid;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household';
  end if;

  select array_agg(user_id order by "position") into v_members
  from public.household_members
  where household_id = p_household_id;
  v_member_count := coalesce(array_length(v_members, 1), 0);

  for r_chore in
    select * from public.chores
    where household_id = p_household_id
      and active
      and public.is_chore_due(cadence_type, cadence_config, start_date, p_for_date)
  loop
    -- Already generated for this date: don't touch rotation state again.
    if exists (
      select 1 from public.chore_instances
      where chore_id = r_chore.id and due_date = p_for_date
    ) then
      continue;
    end if;

    if r_chore.assignment_type = 'fixed' then
      v_assignee := r_chore.fixed_assignee_id;
    else
      if v_member_count = 0 then
        continue; -- no one to assign a rotating chore to yet
      end if;

      insert into public.chore_rotation_state (chore_id, next_position)
      values (r_chore.id, 0)
      on conflict (chore_id) do nothing;

      update public.chore_rotation_state
      set next_position = next_position + 1, updated_at = now()
      where chore_id = r_chore.id
      returning next_position - 1 into v_idx;

      v_assignee := v_members[(v_idx % v_member_count) + 1];
    end if;

    if v_assignee is not null then
      insert into public.chore_instances (chore_id, household_id, due_date, assigned_to)
      values (r_chore.id, p_household_id, p_for_date, v_assignee)
      on conflict (chore_id, due_date) do nothing;
    end if;
  end loop;

  return query
    select * from public.chore_instances
    where household_id = p_household_id and due_date = p_for_date;
end;
$$;
