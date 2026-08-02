/**
 * Server state for the 2-2-2 app.
 *
 * The repository is constructed with `'two_two_two'`, which is the only thing
 * keeping this app's rows separate from the intimacy app's. RLS cannot do it —
 * both partners are legitimate members of the couple — so every read filters on
 * the domain and every write stamps it.
 *
 * Note what is absent: there is no check-in accessor here, because check-ins
 * are intimacy-owned and reachable only through their own factory.
 */
import { computeCadenceStatus, type CadenceStatus } from '@couple/cadence';
import type { Cadence, CostBand, IdeaSource, Locale, Plan } from '@couple/core';
import { createDomainRepository, createIdeaRepository } from '@couple/data';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { DEFAULT_CADENCES, supabase } from './runtime';

export const DOMAIN = 'two_two_two' as const;

export const plans = createDomainRepository(supabase, DOMAIN);

/** 2-2-2-owned. Its own factory, so the intimacy app has nothing to import. */
export const ideas = createIdeaRepository(supabase);

const keys = {
  plans: (coupleId: string) => ['plans', DOMAIN, coupleId] as const,
  cadences: (coupleId: string) => ['cadences', DOMAIN, coupleId] as const,
  ideas: (coupleId: string) => ['ideas', DOMAIN, coupleId] as const,
};

export function usePlans(coupleId: string) {
  return useQuery({ queryKey: keys.plans(coupleId), queryFn: () => plans.listPlans(coupleId) });
}

export function useCadences(coupleId: string) {
  return useQuery({
    queryKey: keys.cadences(coupleId),
    queryFn: () => plans.listCadences(coupleId),
  });
}

/**
 * Seed the three clocks from this app's own kind catalog.
 *
 * Deliberately not a database trigger — a trigger on `couples` would give
 * every couple every app's cadences whichever app they actually installed.
 * Idempotent, because `upsertCadence` upserts on `(couple_id, domain, kind)`.
 */
export async function seedCadences(coupleId: string): Promise<void> {
  for (const kind of DEFAULT_CADENCES) {
    await plans.upsertCadence({
      coupleId,
      kind: kind.kind,
      intervalValue: kind.defaultIntervalValue,
      intervalUnit: kind.defaultIntervalUnit,
    });
  }
}

/**
 * Seed on first run of *this app*, not just on first pairing.
 *
 * Pairing happens once and serves both apps, so whoever installs this one
 * second never passes through the pairing screen — and that screen was the
 * only thing that had ever called `seedCadences`. Without this, 2-2-2 opens to
 * no date night, no getaway and no trip: every countdown the app exists for.
 *
 * Only a genuinely empty list seeds. A cadence switched off keeps its row with
 * `enabled = false`, so turning one off never resurrects it here.
 */
export function useEnsureCadences(coupleId: string): void {
  const client = useQueryClient();
  const { data, isLoading } = useCadences(coupleId);
  const empty = !isLoading && data?.length === 0;

  useEffect(() => {
    if (!empty) return;
    void seedCadences(coupleId).then(() =>
      client.invalidateQueries({ queryKey: keys.cadences(coupleId) }),
    );
  }, [client, coupleId, empty]);
}

/**
 * Book something.
 *
 * Written straight to `scheduled` rather than through a propose/accept loop:
 * this app has no negotiation step, and its three clocks only move for
 * something that is actually on the calendar. The cadence list is invalidated
 * alongside the plans because a new booking changes what the rhythm screen
 * says about being on track.
 */
export function useCreatePlan(coupleId: string, profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: string; title: string | null; startsAt: Date; endsAt: Date }) =>
      plans.createPlan({
        coupleId,
        kind: input.kind,
        createdBy: profileId,
        // Partner-authored, stored and shown verbatim in whatever language it
        // was written.
        title: input.title,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        status: 'scheduled',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
      void client.invalidateQueries({ queryKey: keys.cadences(coupleId) });
    },
  });
}

export function useIdeas(coupleId: string) {
  return useQuery({ queryKey: keys.ideas(coupleId), queryFn: () => ideas.list(coupleId) });
}

/**
 * Save an idea to the couple's shortlist.
 *
 * `locale` is the language the text is actually written in — the reader's own
 * for something they typed, and the reader's own again for a library entry,
 * since the bundled text is rendered in whoever is looking at it. It is a
 * label, never an instruction to translate.
 */
export function useSaveIdea(coupleId: string, profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: string;
      title: string;
      summary?: string | null;
      /** Only suggestions carry one; the library and manual entry leave it null. */
      estCostBand?: CostBand | null;
      source: IdeaSource;
      locale: Locale;
    }) =>
      ideas.save({
        coupleId,
        kind: input.kind,
        savedBy: profileId,
        title: input.title,
        summary: input.summary ?? null,
        estCostBand: input.estCostBand ?? null,
        source: input.source,
        locale: input.locale,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.ideas(coupleId) });
    },
  });
}

export function useRemoveIdea(coupleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ideaId: string) => ideas.remove(ideaId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.ideas(coupleId) });
    },
  });
}

/**
 * Keep this device in step with the other one.
 *
 * Mounted once, in the tabs layout, rather than per screen: both tabs stay
 * mounted, so a per-screen call opened the same topic more than once for no
 * benefit.
 *
 * Every handler invalidates and refetches rather than patching the cache from
 * the payload. That is not only for consistency — a delete event carries just
 * the primary key, so there is nothing to patch a row from.
 *
 * The `filter` on `plans` is load-bearing, not an optimisation. Without it the
 * server sends every plan row the couple can read — `domain = 'intimacy'` rows
 * included, `title` and `notes` and all — into this app's socket. Discarding
 * the payload in the callback is not the same as never receiving it, and the
 * whole point of the domain-scoped repository is that intimacy rows never
 * reach this app. `postgres_changes` accepts one `column=op.value`, so it goes
 * on the column RLS provably cannot express; the couple scoping RLS does.
 *
 * Why `plan_ideas` is deliberately *not* filtered: a filter is matched against
 * the replica identity, and with the default identity a delete carries only
 * the primary key — so filtering on any other column silently drops deletes.
 * The shortlist is the one list here that is genuinely deleted from
 * (`useRemoveIdea`), and it is 2-2-2-owned outright, so there is no boundary
 * to protect and a filter would only cost a removal that never syncs. `plans`
 * has the opposite shape: two domains share it, and nothing deletes a plan.
 */
export function useRealtimeSync(coupleId: string | null): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!coupleId) return;
    const channel = supabase
      .channel(`two22:${coupleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'plans', filter: `domain=eq.${DOMAIN}` },
        () => {
          void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
        },
      )
      // The shortlist is shared, and both partners read it while deciding what
      // to book. Requires `plan_ideas` in the `supabase_realtime` publication —
      // `tests/guards/realtime-subscriptions.test.ts` holds the two together.
      // Unfiltered on purpose; see the note above about deletes.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_ideas' }, () => {
        void client.invalidateQueries({ queryKey: keys.ideas(coupleId) });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [client, coupleId]);
}

/** Cadence statuses for every enabled ritual, most urgent first. */
export function cadenceStatuses(
  cadences: Cadence[],
  allPlans: Plan[],
  coupleCreatedAt: string,
  timeZone: string,
  now: Date,
): CadenceStatus[] {
  return cadences
    .filter((cadence) => cadence.enabled)
    .map((cadence) =>
      computeCadenceStatus({
        cadence,
        plans: allPlans,
        now,
        coupleCreatedAt: new Date(coupleCreatedAt),
        timeZone,
      }),
    )
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
