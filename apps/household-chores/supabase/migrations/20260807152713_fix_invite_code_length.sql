-- Fix invite codes that come out shorter than 6 characters.
--
-- `(random() * 31)::int` ROUNDS rather than truncates, so it yields 0..31
-- instead of 0..30. With the `+ 1` that means index 32, one past the end of
-- the 31-character alphabet, and `substr()` past the end returns '' -- so
-- roughly 9% of generated codes were 5 (or occasionally 4) characters.
--
-- That was not merely cosmetic: join_household_by_code is reached through a
-- form whose schema requires *exactly* 6 characters, so any household issued
-- a short code could never be joined.
--
-- floor() truncates, giving a uniform 0..30 -> index 1..31. It also removes
-- the old half-weight bias on the first alphabet character.

create or replace function public.generate_invite_code()
returns text
language sql
volatile
as $$
  -- Unambiguous alphabet: no 0/O/1/I/L.
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', floor(random() * 31)::int + 1, 1),
    ''
  )
  from generate_series(1, 6);
$$;
