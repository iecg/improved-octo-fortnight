-- Client-side encryption: where devices publish their public keys, and where
-- the couple key is parked — sealed — for the other device to pick up.
--
-- Nothing added here is readable by the server, and that is the whole point of
-- the file:
--
--   * `device_keys` holds public keys, which are public by definition.
--   * `couple_key_wraps` holds the couple key sealed to one device's public
--     key. Useless without that device's secret, which never leaves its
--     keychain.
--   * `couple_key_recovery` holds it sealed under a code that exists on paper
--     and nowhere else.
--
-- The content columns themselves are not here. Since nothing has shipped, the
-- four table-creating migrations were edited in place instead, so a future
-- reader sees an encrypted schema rather than an archaeological layer of `add
-- column` and `drop column`.
--
-- Grants mirror the policies exactly, the same two-locks shape as
-- 20260802000300_table_grants.sql: a table with no update policy also has no
-- update privilege.

-- ---------------------------------------------------------------------------
-- Device public keys.
--
-- One row per device per person. There is deliberately no device *label*
-- column: "Alice's iPhone" is content, it would sit here in plaintext for the
-- sake of a nicety, and what the approving partner actually needs is the
-- verification code and the timestamp — both of which they already have.
-- ---------------------------------------------------------------------------

create table public.device_keys (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- base64 of a 32-byte X25519 public key.
  public_key text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, public_key),
  constraint device_keys_public_key_format check (public_key ~ '^[A-Za-z0-9+/]{40,64}={0,2}$')
);

create index device_keys_profile_idx on public.device_keys (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The couple key, wrapped for a device.
--
-- Sealed with X25519(sender's secret, this device's public) rather than with a
-- sealed box. The difference matters: with a sealed box anyone holding the
-- recipient's public key can produce a valid-looking wrap, so whoever runs this
-- database could hand a joining device a couple key *of their own choosing* and
-- then read everything that device went on to write. Deriving from both static
-- secrets makes the tag proof that the wrap came from the partner's device.
-- ---------------------------------------------------------------------------

create table public.couple_key_wraps (
  couple_id uuid not null references public.couples (id) on delete cascade,
  device_key_id uuid not null references public.device_keys (id) on delete cascade,
  epoch integer not null default 0 check (epoch >= 0),
  wrapped_key text not null,
  wrapped_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (couple_id, device_key_id, epoch),
  -- Format and length as two constraints rather than one bounded repetition:
  -- Postgres caps a regex repetition count at 255, so `{40,400}` is not an
  -- expensive pattern, it is a syntax error at insert time.
  constraint couple_key_wraps_format check (wrapped_key ~ '^[A-Za-z0-9+/]+={0,2}$'),
  constraint couple_key_wraps_bounded check (length(wrapped_key) between 40 and 400)
);

-- ---------------------------------------------------------------------------
-- The optional recovery envelope.
--
-- Yours alone — not the partner's, who has no business reading it and no need
-- to. This is the only blob in the schema an offline attacker could even
-- attempt, which is why the code it is sealed under is generated rather than
-- chosen: 125 bits, never a passphrase someone thought of.
-- ---------------------------------------------------------------------------

create table public.couple_key_recovery (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  couple_id uuid not null references public.couples (id) on delete cascade,
  epoch integer not null default 0 check (epoch >= 0),
  kdf text not null check (kdf = 'scrypt-v1'),
  kdf_salt text not null,
  kdf_params jsonb not null,
  wrapped_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger couple_key_recovery_touch_updated_at
  before update on public.couple_key_recovery
  for each row execute function public.touch_updated_at();

alter table public.device_keys enable row level security;
alter table public.couple_key_wraps enable row level security;
alter table public.couple_key_recovery enable row level security;

-- ----------------------------------------------------------------- policies

-- The same shape as profiles_select_self_or_partner: you, and the person you
-- are paired with. The partner's public key is exactly what an approving device
-- needs in order to compute the verification code the two people compare.
create policy device_keys_select_self_or_partner on public.device_keys
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1
      from public.couple_members
      where couple_id = public.current_couple_id()
        and profile_id = public.device_keys.profile_id
    )
  );

create policy device_keys_insert_own on public.device_keys
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

create policy device_keys_delete_own on public.device_keys
  for delete to authenticated
  using (profile_id = (select auth.uid()));

-- No update policy, and no update grant below. A public key is not edited, it
-- is replaced — and revoking one is a delete, which takes its wraps with it.

create policy couple_key_wraps_select_member on public.couple_key_wraps
  for select to authenticated
  using (public.is_couple_member(couple_id));

create policy couple_key_wraps_insert_member on public.couple_key_wraps
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and wrapped_by = (select auth.uid()));

create policy couple_key_wraps_delete_member on public.couple_key_wraps
  for delete to authenticated
  using (public.is_couple_member(couple_id));

create policy couple_key_recovery_all_own on public.couple_key_recovery
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()) and public.is_couple_member(couple_id));

-- ------------------------------------------------------------------- grants

grant select, insert, delete on public.device_keys to authenticated;
grant select, insert, delete on public.couple_key_wraps to authenticated;
grant select, insert, update, delete on public.couple_key_recovery to authenticated;

-- Authorship pinned the same way 20260802000400_data_protection.sql pins it
-- everywhere else: the insert policy is the only place these are checked, so
-- without this they are one UPDATE from meaningless.
create trigger couple_key_recovery_immutable_identity
  before update on public.couple_key_recovery
  for each row execute function public.enforce_immutable_columns('profile_id', 'couple_id');

-- So a pairing screen sees the partner's device appear, and a waiting device
-- sees its wrap arrive, without polling for either.
alter publication supabase_realtime add table public.device_keys;
alter publication supabase_realtime add table public.couple_key_wraps;

-- ---------------------------------------------------------------------------
-- Leaving now also drops the name.
--
-- A name sealed under couple A's key, with couple A's id inside its AAD, is
-- permanently unreadable to couple B — so carrying it across would leave a blob
-- that can never be opened again and looks like data. Same reasoning the
-- departure handler already applies to invite codes and to empty couples;
-- replaced here rather than given a second trigger on the same event.
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
  update public.profiles set name_payload = null where id = old.profile_id;

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
