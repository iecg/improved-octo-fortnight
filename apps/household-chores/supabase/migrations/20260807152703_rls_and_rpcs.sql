-- Household Chores: Row Level Security + business-rule RPCs
--
-- Membership-changing actions (create household, join by code, regenerate
-- code, instance generation + rotation) go through SECURITY DEFINER
-- functions rather than raw insert/update policies, so the actual business
-- rules live in one place instead of being reconstructed inside RLS
-- expressions. Everything else (chores CRUD, marking an instance complete)
-- is exposed directly to authenticated clients, gated by household
-- membership via RLS.

-- ---------------------------------------------------------------------------
-- Membership helper (SECURITY DEFINER avoids self-referential RLS recursion
-- when household_members' own policies need to check household_members).
-- ---------------------------------------------------------------------------
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(p_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.push_tokens enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.chores enable row level security;
alter table public.chore_rotation_state enable row level security;
alter table public.chore_instances enable row level security;

-- profiles: visible to self and household co-members; editable by self only
create policy "profiles select self and household co-members"
  on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from public.household_members m
      where m.user_id = profiles.id and public.is_household_member(m.household_id)
    )
  );

create policy "profiles update self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- push_tokens: fully owned by the registering user
create policy "push tokens select own"
  on public.push_tokens for select
  using (user_id = auth.uid());

create policy "push tokens insert own"
  on public.push_tokens for insert
  with check (user_id = auth.uid());

create policy "push tokens update own"
  on public.push_tokens for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "push tokens delete own"
  on public.push_tokens for delete
  using (user_id = auth.uid());

-- households: members can view; only owners can edit name/timezone directly.
-- Creation happens exclusively via create_household().
create policy "households select member"
  on public.households for select
  using (public.is_household_member(id));

create policy "households update owner"
  on public.households for update
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

-- household_members: members can view the roster; a member may remove
-- their own row (leave household). Joining happens via join_household_by_code().
create policy "household members select roster"
  on public.household_members for select
  using (public.is_household_member(household_id));

create policy "household members leave"
  on public.household_members for delete
  using (user_id = auth.uid());

-- chores: full CRUD for any household member
create policy "chores select household"
  on public.chores for select
  using (public.is_household_member(household_id));

create policy "chores insert household"
  on public.chores for insert
  with check (public.is_household_member(household_id));

create policy "chores update household"
  on public.chores for update
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "chores delete household"
  on public.chores for delete
  using (public.is_household_member(household_id));

-- chore_rotation_state: internal bookkeeping, read-only visibility for
-- debugging; all writes happen inside ensure_todays_instances().
create policy "chore rotation state select household"
  on public.chore_rotation_state for select
  using (
    exists (
      select 1 from public.chores c
      where c.id = chore_rotation_state.chore_id
        and public.is_household_member(c.household_id)
    )
  );

-- chore_instances: any household member can view and mark instances
-- complete (logging a chore on a housemate's behalf is allowed by design).
-- Rows are only ever created via ensure_todays_instances().
create policy "chore instances select household"
  on public.chore_instances for select
  using (public.is_household_member(household_id));

create policy "chore instances update household"
  on public.chore_instances for update
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------
create or replace function public.generate_invite_code()
returns text
language sql
volatile
as $$
  -- Unambiguous alphabet: no 0/O/1/I/L.
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (random() * 31)::int + 1, 1),
    ''
  )
  from generate_series(1, 6);
$$;

create or replace function public.create_household(p_name text, p_timezone text default 'UTC')
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household public.households;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  loop
    v_code := public.generate_invite_code();
    exit when not exists (select 1 from public.households where invite_code = v_code);
  end loop;

  insert into public.households (name, invite_code, timezone, created_by)
  values (p_name, v_code, coalesce(p_timezone, 'UTC'), auth.uid())
  returning * into v_household;

  insert into public.household_members (household_id, user_id, role, "position")
  values (v_household.id, auth.uid(), 'owner', 0);

  return v_household;
end;
$$;

create or replace function public.join_household_by_code(p_code text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household public.households;
  v_next_position int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_household from public.households where invite_code = upper(p_code);
  if v_household.id is null then
    raise exception 'Invalid invite code';
  end if;

  -- Idempotent: joining a household you're already in just returns it.
  if exists (
    select 1 from public.household_members
    where household_id = v_household.id and user_id = auth.uid()
  ) then
    return v_household;
  end if;

  select coalesce(max("position") + 1, 0) into v_next_position
  from public.household_members where household_id = v_household.id;

  insert into public.household_members (household_id, user_id, role, "position")
  values (v_household.id, auth.uid(), 'member', v_next_position);

  return v_household;
end;
$$;

create or replace function public.regenerate_invite_code(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_household_owner(p_household_id) then
    raise exception 'Only the household owner can regenerate the invite code';
  end if;

  loop
    v_code := public.generate_invite_code();
    exit when not exists (select 1 from public.households where invite_code = v_code);
  end loop;

  update public.households set invite_code = v_code where id = p_household_id;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cadence due-date predicate (pure, mirrored client-side in lib/cadence.ts)
-- ---------------------------------------------------------------------------
create or replace function public.is_chore_due(
  p_cadence_type public.cadence_type,
  p_cadence_config jsonb,
  p_start_date date,
  p_check_date date
)
returns boolean
language sql
immutable
as $$
  select case p_cadence_type
    when 'daily' then p_check_date >= p_start_date
    when 'weekly_days' then
      p_check_date >= p_start_date
      and extract(dow from p_check_date)::int = any (
        array(select jsonb_array_elements_text(p_cadence_config -> 'weekdays'))::int[]
      )
    when 'every_n_days' then
      p_check_date >= p_start_date
      and mod((p_check_date - p_start_date), greatest((p_cadence_config ->> 'n')::int, 1)) = 0
    when 'monthly' then
      p_check_date >= p_start_date
      and extract(day from p_check_date)::int = least(
        (p_cadence_config ->> 'day_of_month')::int,
        extract(day from (date_trunc('month', p_check_date) + interval '1 month - 1 day'))::int
      )
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- Instance generation + rotation
-- ---------------------------------------------------------------------------
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

grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household_by_code(text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.ensure_todays_instances(uuid, date) to authenticated;
