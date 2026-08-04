/**
 * Plan ideas — 2-2-2-app-owned.
 *
 * In its own module behind its own factory, the same way check-ins are, so the
 * intimacy app has nothing to import even by accident. The factory hard-codes
 * `two_two_two` rather than taking a domain, because there is no second caller
 * and a domain parameter is exactly the shape the boundary rule forbids.
 *
 * Nothing here knows whether a model exists. The curated library ships in the
 * app bundle and manual entry is a text field, so this table fills up and the
 * feature works with no API key configured anywhere — `source` simply never
 * reads `'ai'`. (Naming the key here would trip the guard in
 * `tests/guards/ai-optional.test.ts`, which is the point of it.)
 */
import type { CostBand, IdeaSource, Locale, PlanIdea } from '@couple/core';

import type { FieldCipher } from '@couple/crypto';

import type { AppSupabaseClient } from './client';
import { toPlanIdea } from './mappers';

const DOMAIN = 'two_two_two';

export interface SaveIdeaInput {
  coupleId: string;
  kind: string;
  savedBy: string;
  /** Stored and shown exactly as written. */
  title: string;
  summary?: string | null;
  url?: string | null;
  estCostBand?: CostBand | null;
  source: IdeaSource;
  /** Which provider named this. Null for library, manual, and ai. */
  sourceDomain?: string | null;
  /** The language the title and summary are written in. */
  locale: Locale;
}

export interface IdeaRepository {
  /**
   * The whole shortlist, in one query.
   *
   * Deliberately not per kind. The ideas screen switches kinds with a chip
   * row and filters this list in memory, which is instant and needs no
   * refetch — and there is one cache key and one realtime handler for the
   * list rather than one of each per kind.
   */
  list(coupleId: string): Promise<PlanIdea[]>;
  save(input: SaveIdeaInput): Promise<PlanIdea>;
  remove(ideaId: string): Promise<void>;
}

export function createIdeaRepository(
  client: AppSupabaseClient,
  cipher: FieldCipher,
): IdeaRepository {
  if (cipher.scope !== DOMAIN) {
    throw new Error(`ideas are ${DOMAIN}-owned; got a ${cipher.scope} cipher`);
  }

  return {
    async list(coupleId) {
      const { data, error } = await client
        .from('plan_ideas')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('domain', DOMAIN)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toPlanIdea(row, cipher));
    },

    async save(input) {
      // Minted here because the payload's AAD binds to it.
      const id = cipher.newId();

      const { data, error } = await client
        .from('plan_ideas')
        .insert({
          id,
          couple_id: input.coupleId,
          domain: DOMAIN,
          kind: input.kind,
          saved_by: input.savedBy,
          // `source` stays outside: it is provenance, not content — where an
          // idea came from rather than what it is — and it is what the
          // ai_usage story reasons about. `locale` goes inside, because it
          // describes the language of the words, which are sealed.
          payload: cipher.seal(
            {
              title: input.title,
              summary: input.summary ?? null,
              url: input.url ?? null,
              estCostBand: input.estCostBand ?? null,
              locale: input.locale,
            },
            { table: 'plan_ideas', coupleId: input.coupleId, id },
          ),
          source: input.source,
          source_domain: input.sourceDomain ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPlanIdea(data, cipher);
    },

    async remove(ideaId) {
      const { error } = await client
        .from('plan_ideas')
        .delete()
        .eq('id', ideaId)
        .eq('domain', DOMAIN);
      if (error) throw new Error(error.message);
    },
  };
}
