-- Per-couple daily cap for the optional places feature.
--
-- Stays empty when no mapping key is configured, exactly like `ai_usage`. The
-- two are deliberately separate tables rather than one counter with a column
-- per feature: they are independent optional features, and sharing a counter
-- would mean a day of map searches silences idea suggestions. Neither
-- feature's limit is a sensible limit for the other. If a third provider ever
-- appears, that is the moment to generalize — not before.
--
-- The cap is not really about abuse by these two people. It is that the key
-- lives in an Edge Function secret and every request is billed to whoever owns
-- it, so a loop in a screen is a bill rather than a bug.

create table public.places_usage (
  couple_id uuid not null references public.couples (id) on delete cascade,
  day date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (couple_id, day)
);

comment on table public.places_usage is
  'Per-couple daily cap for the optional places feature. Stays empty when no mapping key is configured.';

alter table public.places_usage enable row level security;

-- Readable so a screen can say what is left today; only the Edge Function's
-- service role increments it, so there is no insert or update policy here. A
-- client that could write here could reset its own cap.
create policy places_usage_select_member on public.places_usage
  for select to authenticated
  using (public.is_couple_member(couple_id));

revoke all on public.places_usage from anon;
revoke all on public.places_usage from authenticated;
grant select on public.places_usage to authenticated;

-- Count one request against a couple's day and return the running total.
--
-- One statement, so two devices searching at the same moment cannot both read
-- the same count and both decide there is room — the mistake the ported
-- couple-size trigger made with `count(*)`, in a place where the cost of
-- getting it wrong is somebody's bill rather than a third person in the couple.
--
-- SECURITY DEFINER and revoked from clients: only the Edge Function's service
-- role calls this. It takes the couple as an argument because the function
-- resolves it from the caller's own JWT before calling, and passing it in keeps
-- this callable from a service-role context that has no `auth.uid()`.
create function public.increment_places_usage(p_couple_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.places_usage (couple_id, day, request_count)
  values (p_couple_id, current_date, 1)
  on conflict (couple_id, day)
    do update set request_count = public.places_usage.request_count + 1
  returning request_count;
$$;

revoke all on function public.increment_places_usage(uuid) from public, anon, authenticated;
