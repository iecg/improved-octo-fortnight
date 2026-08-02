-- A fourth way an idea can arrive: found on a map.
--
-- Its own source value rather than reusing 'manual', because the two are not
-- the same thing and the difference is visible to a reader. A manual idea is
-- partner-authored text; a places idea is a real venue somebody else named, and
-- it is the one kind of idea that can go stale — a restaurant closes. Keeping
-- them apart is what lets a later refresh find the ones worth re-checking.
--
-- 'library' and 'manual' remain the two that need nothing configured, which is
-- still what makes the ideas screen work with no key anywhere.

alter table public.plan_ideas drop constraint plan_ideas_source_check;

alter table public.plan_ideas
  add constraint plan_ideas_source_check
  check (source in ('library', 'ai', 'manual', 'places'));

-- Written since the table was created and read by nothing. It is the natural
-- home for which provider named a venue, so a later "is this place still
-- there" pass knows who to ask.
comment on column public.plan_ideas.source_domain is
  'Which provider named this idea, for sources that came from one. Null for library, manual, and ai.';
