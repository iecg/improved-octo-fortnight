-- Tables owned by the 2-2-2 app.
--
-- Ported from iecg/legendary-bassoon#2 with one change: `kind` was a
-- `cadence_kind` enum there and becomes `(domain, kind)` slugs here, matching
-- `cadences` and `plans`. The enum would have made every idea a 2-2-2 idea by
-- construction, which is fine in a single-app repo and wrong in this one.
--
-- The intimacy app never queries these. That is a query-layer invariant —
-- `packages/data` exposes them only through the 2-2-2 repository — because RLS
-- cannot express it: both partners are legitimate members of the couple.
--
-- Everything here supports the app's AI-optional rule. `plan_ideas` is
-- populated by a bundled curated library and by hand long before any model is
-- involved, and `ai_usage` simply sits at zero when no key is configured.

create table public.plan_ideas (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  domain public.slug not null,
  kind public.slug not null,
  -- Title, summary, url, cost band, and the language the text is written in.
  --
  -- The locale is in here with them rather than beside them because it
  -- describes the *content*: it exists so a reader can be told "this was
  -- written in Spanish" rather than have it machine-translated, and that is a
  -- fact about the words, which are sealed.
  payload text not null,
  -- 'library' (bundled, offline), 'manual' (written by a partner), or 'ai'.
  -- The first two are what make the feature work with no model available.
  --
  -- Stays readable because it is provenance rather than content — it says
  -- where an idea came from, never what it is, and it is what the `ai_usage`
  -- story reasons about.
  source text not null check (source in ('library', 'ai', 'manual')),
  saved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint plan_ideas_payload_format check (payload ~ '^[A-Za-z0-9+/]+={0,2}$'),
  constraint plan_ideas_payload_bounded check (length(payload) between 64 and 16000)
);

create index plan_ideas_couple_kind_idx on public.plan_ideas (couple_id, domain, kind);

create table public.ai_usage (
  couple_id uuid not null references public.couples (id) on delete cascade,
  day date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (couple_id, day)
);

comment on table public.ai_usage is
  'Per-couple daily cap for the optional AI suggestion feature. Stays empty when no model is configured.';

alter table public.plan_ideas enable row level security;
alter table public.ai_usage enable row level security;

create policy plan_ideas_select_member on public.plan_ideas
  for select to authenticated
  using (public.is_couple_member(couple_id));

create policy plan_ideas_insert_member on public.plan_ideas
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and saved_by = (select auth.uid()));

create policy plan_ideas_update_member on public.plan_ideas
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

create policy plan_ideas_delete_member on public.plan_ideas
  for delete to authenticated
  using (public.is_couple_member(couple_id));

-- Readable so the UI can show what is left today; only the Edge Function's
-- service role increments it, so there is no insert or update policy here.
create policy ai_usage_select_member on public.ai_usage
  for select to authenticated
  using (public.is_couple_member(couple_id));

revoke all on public.plan_ideas from anon;
revoke all on public.ai_usage from anon;
revoke all on public.ai_usage from authenticated;
grant select on public.ai_usage to authenticated;
