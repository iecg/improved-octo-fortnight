-- Pairing hardening.
--
-- Four changes, three of them adopted from the 2-2-2 app's schema review
-- (iecg/legendary-bassoon#2) and one prompted by it. Written as a separate
-- migration rather than edited into the originals so it replays cleanly
-- against a database that already has them.

-- pgcrypto lives in the `extensions` schema on Supabase and usually in
-- `public` on a plain cluster. Creating it into `extensions` and putting both
-- schemas on the search path of the one function that needs it makes this
-- work either way.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Invite codes from a CSPRNG.
--
-- The previous version drew from `random()`, a per-session deterministic PRNG
-- that has no business backing a credential, at six characters. This is the
-- 2-2-2 app's generator: cryptographic bytes, rejection sampling so the
-- alphabet stays uniform, and eight characters.
--
-- Entropy is only half of it — see the column-level grant below, without which
-- a client can simply overwrite the value this produces.
-- ---------------------------------------------------------------------------

create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Crockford-ish: no I, L, O, U, so a code read aloud is unambiguous.
  alphabet     constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  alphabet_len constant int  := 30;
  code_length  constant int  := 8;
  -- Largest multiple of the alphabet size that fits in a byte (240). Bytes at
  -- or above it are discarded; taking them modulo 30 would make the first
  -- sixteen characters measurably more likely than the rest.
  unbiased_max constant int  := (256 / alphabet_len) * alphabet_len;
  candidate text;
  byte_value int;
begin
  loop
    candidate := '';
    while length(candidate) < code_length loop
      byte_value := get_byte(gen_random_bytes(1), 0);
      continue when byte_value >= unbiased_max;
      candidate := candidate || substr(alphabet, 1 + (byte_value % alphabet_len), 1);
    end loop;
    exit when not exists (select 1 from public.couples where invite_code = candidate);
  end loop;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rate limit redemption attempts.
--
-- Entropy bounds *offline* guessing. Online guessing is bounded by request
-- rate, and these repositories are public — the alphabet, the length, and the
-- exact code format are all readable. Counting per profile means an attacker
-- needs a fresh authenticated account per bucket rather than a fresh request.
-- ---------------------------------------------------------------------------

create table public.join_attempts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now()
);

-- Only the security-definer RPC touches this. No policies, so RLS denies
-- everything else by default; the revoke removes the table from reach entirely.
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Serialize redemption, and rotate the code once used.
--
-- The `for update` was already here and is what stops two people redeeming the
-- same code concurrently and producing a three-member couple — the size
-- trigger alone cannot, because under READ COMMITTED neither transaction sees
-- the other's uncommitted insert. Reproduced against the 2-2-2 schema, which
-- has the trigger but no lock. Restated here so the reason survives.
-- ---------------------------------------------------------------------------

-- Returns a result rather than raising, for two reasons that turned out to be
-- the same reason.
--
-- `raise` aborts the transaction, which rolls back the very increment that
-- records the failed attempt — a rate limiter that reports failure by raising
-- can never count anything. A counter has to survive the response.
--
-- And the raised text was reaching the UI as `error.message`: an English
-- string from Postgres rendered to a partner reading Spanish. Machine-readable
-- reasons go through translation keys like every other token in this schema.
--
-- Shape: {"ok": true, "couple_id": "..."} or {"ok": false, "reason": "..."}.
--
-- Dropped rather than replaced: the return type changes from uuid to jsonb,
-- and CREATE OR REPLACE cannot do that.
drop function if exists public.join_couple(text);

create function public.join_couple(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_couple_id uuid;
  v_members integer;
  v_attempts integer;
  v_window_started timestamptz;
  max_attempts constant integer := 10;
  window_length constant interval := interval '15 minutes';
begin
  -- The one genuine raise: an unauthenticated caller is a programming error,
  -- not a user mistake, and there is no bucket to charge it to.
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if exists (select 1 from public.couple_members where profile_id = (select auth.uid())) then
    return jsonb_build_object('ok', false, 'reason', 'already_paired');
  end if;

  -- Take the caller's rate-limit bucket first, and hold the row for the rest
  -- of the transaction so parallel attempts cannot each read a stale count.
  insert into public.join_attempts (profile_id)
  values ((select auth.uid()))
  on conflict (profile_id) do nothing;

  select attempts, window_started_at
  into v_attempts, v_window_started
  from public.join_attempts
  where profile_id = (select auth.uid())
  for update;

  if now() - v_window_started > window_length then
    v_attempts := 0;
    update public.join_attempts
    set attempts = 0, window_started_at = now()
    where profile_id = (select auth.uid());
  end if;

  if v_attempts >= max_attempts then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- `for update` serializes two people redeeming the same code at once: the
  -- second blocks here, then re-reads the member count after the first commits.
  select id into v_couple_id
  from public.couples
  where invite_code = upper(trim(p_code))
  for update;

  if v_couple_id is null then
    update public.join_attempts
    set attempts = attempts + 1
    where profile_id = (select auth.uid());
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  select count(*) into v_members
  from public.couple_members
  where couple_id = v_couple_id;

  if v_members >= 2 then
    -- Deliberately not counted as a failed guess: the code was correct, so
    -- this tells the attacker nothing they did not already know, and counting
    -- it would let a full couple's circulating code lock out a legitimate user.
    return jsonb_build_object('ok', false, 'reason', 'couple_full');
  end if;

  insert into public.couple_members (couple_id, profile_id)
  values (v_couple_id, (select auth.uid()));

  -- The code has done its job. Rotating it means a forwarded link or a
  -- screenshot in a camera roll cannot be replayed later — which matters
  -- because leaving a couple reopens the slot.
  update public.couples
  set invite_code = public.generate_invite_code()
  where id = v_couple_id;

  -- Paired, so the bucket is no longer needed.
  delete from public.join_attempts where profile_id = (select auth.uid());

  return jsonb_build_object('ok', true, 'couple_id', v_couple_id);
end;
$$;

revoke all on function public.generate_invite_code() from public;
revoke all on function public.join_couple(text) from public;
grant execute on function public.join_couple(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Plan integrity, both adopted from the 2-2-2 schema.
-- ---------------------------------------------------------------------------

-- A biconditional: completing sets the timestamp, and anything else clears it.
-- Previously enforced in the repository layer, which is the wrong place — a
-- stale completed_at silently re-anchors the cadence to something that never
-- happened.
alter table public.plans
  add constraint plans_completed_has_timestamp
  check ((status = 'completed') = (completed_at is not null));

-- Deleting a profile should not delete the couple's shared history with it.
-- The insert policy still requires created_by = auth.uid(), so this stays
-- non-null for every row the client writes; only a profile deletion can null
-- it.
alter table public.plans drop constraint plans_created_by_fkey;
alter table public.plans alter column created_by drop not null;
alter table public.plans
  add constraint plans_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;
