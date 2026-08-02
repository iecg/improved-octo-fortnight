/**
 * Server state.
 *
 * Everything goes through the domain-scoped repositories in `@couple/data`,
 * which is what keeps this app's rows separate from the 2-2-2 app's.
 */
import { computeCadenceStatus, type CadenceStatus } from '@couple/cadence';
import type { Cadence, CheckinInterest, Plan, PlanProposal } from '@couple/core';
import { createBusyRepository, createCheckinRepository, createDomainRepository } from '@couple/data';
import { calendarDateIn } from '@couple/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { DEFAULT_INTIMACY_CADENCES, supabase } from './runtime';

export const DOMAIN = 'intimacy' as const;

export const plans = createDomainRepository(supabase, DOMAIN);
export const checkins = createCheckinRepository(supabase);

/**
 * Times the couple is occupied, across both apps — and only times.
 *
 * Read unconditionally here, unlike in the 2-2-2 app. What it exposes in this
 * direction is that a date night is booked, which is not a secret, and this
 * app is the one behind the lock. The reverse direction is the one that needs
 * asking about.
 */
export const busy = createBusyRepository(supabase);

const keys = {
  plans: (coupleId: string) => ['plans', DOMAIN, coupleId] as const,
  cadences: (coupleId: string) => ['cadences', DOMAIN, coupleId] as const,
  proposals: (coupleId: string) => ['proposals', DOMAIN, coupleId] as const,
  checkins: (coupleId: string, date: string) => ['checkins', coupleId, date] as const,
  // Not domain-keyed: this list is the same one either app would read.
  busy: (coupleId: string, from: string, to: string) => ['busy', coupleId, from, to] as const,
};

export function usePlans(coupleId: string) {
  return useQuery({
    queryKey: keys.plans(coupleId),
    queryFn: () => plans.listPlans(coupleId),
  });
}

export function useCadences(coupleId: string) {
  return useQuery({
    queryKey: keys.cadences(coupleId),
    queryFn: () => plans.listCadences(coupleId),
  });
}

/**
 * Pause a ritual, or bring it back.
 *
 * A paused cadence keeps its row with `enabled = false` rather than being
 * deleted, which is what lets `useEnsureCadences` tell "never seeded" from
 * "switched off". The plans already made under it stay where they are: this
 * turns off a countdown, not a history.
 */
export function useSetCadenceEnabled(coupleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { cadenceId: string; enabled: boolean }) =>
      plans.setCadenceEnabled(input.cadenceId, input.enabled),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.cadences(coupleId) });
    },
  });
}

/**
 * Seed this app's standing rituals from its own kind catalog.
 *
 * Deliberately not a database trigger — a trigger on `couples` would give
 * every couple every app's cadences whichever app they actually installed.
 * Idempotent, because `upsertCadence` upserts on `(couple_id, domain, kind)`.
 */
export async function seedCadences(coupleId: string): Promise<void> {
  for (const kind of DEFAULT_INTIMACY_CADENCES) {
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
 * Pairing happens once and serves both apps, so the partner who installs the
 * second one never passes through the pairing screen — and that screen was the
 * only thing that had ever called `seedCadences`. Without this the second app
 * opens to an empty rhythm and there is no other way to create a cadence.
 *
 * Only a genuinely empty list seeds. A ritual switched off keeps its row with
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
 * Occupied windows from the server, both apps' plans, times only.
 *
 * This is what lets the propose screen work on a phone where calendar access
 * was refused — and it is the only thing that knows about a `proposed` time,
 * which by design reaches no calendar at all.
 *
 * The bounds are part of the key so a screen that widens its range refetches
 * rather than quietly reusing a narrower answer.
 */
export function useServerBusy(coupleId: string, from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery({
    queryKey: keys.busy(coupleId, fromIso, toIso),
    queryFn: () => busy.listBetween(coupleId, from, to),
  });
}

export function usePendingProposals(coupleId: string) {
  return useQuery({
    queryKey: keys.proposals(coupleId),
    queryFn: () => plans.listPendingProposals(coupleId),
  });
}

export function useCheckins(coupleId: string, timeZone: string, now: Date) {
  const date = calendarDateIn(now, timeZone);
  return useQuery({
    queryKey: keys.checkins(coupleId, date),
    queryFn: () => checkins.listForDate(coupleId, date),
  });
}

export function useRecordCheckin(coupleId: string, profileId: string, timeZone: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { interest: CheckinInterest; note?: string | null; now: Date }) =>
      checkins.record({
        coupleId,
        profileId,
        onDate: calendarDateIn(input.now, timeZone),
        interest: input.interest,
        note: input.note ?? null,
      }),
    onSuccess: (_result, input) => {
      void client.invalidateQueries({
        queryKey: keys.checkins(coupleId, calendarDateIn(input.now, timeZone)),
      });
    },
  });
}

export function useRespondToProposal(coupleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { proposal: PlanProposal; response: 'accepted' | 'declined' }) => {
      await plans.respond(input.proposal.id, input.response);
      // Accepting is what turns a suggestion into something on the calendar.
      if (input.response === 'accepted') {
        await plans.updatePlan(input.proposal.planId, {
          status: 'scheduled',
          startsAt: input.proposal.startsAt,
          endsAt: input.proposal.endsAt,
        });
      } else {
        await plans.updatePlan(input.proposal.planId, { status: 'declined' });
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.proposals(coupleId) });
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
    },
  });
}

/**
 * Answer a proposal with a different time.
 *
 * "Countered" is a real answer, not a soft decline — the original is closed
 * out and the reply hangs off the *same plan*, chained back through
 * `countered_from`, so the negotiation reads as one thread rather than a pile
 * of unrelated suggestions. The plan itself stays `proposed`: nothing is
 * booked until somebody actually says yes.
 */
export function useCounterProposal(coupleId: string, profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      proposalId: string;
      planId: string;
      startsAt: Date;
      endsAt: Date;
    }) => {
      // Order matters: closing the original first means a failure here leaves
      // no second pending proposal competing with it.
      await plans.respond(input.proposalId, 'countered');
      return plans.propose({
        planId: input.planId,
        coupleId,
        proposedBy: profileId,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        counteredFrom: input.proposalId,
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.proposals(coupleId) });
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
    },
  });
}

export function useProposeTime(coupleId: string, profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      kind: string;
      startsAt: Date;
      endsAt: Date;
      notes?: string | null;
    }) => {
      const plan = await plans.createPlan({
        coupleId,
        kind: input.kind,
        createdBy: profileId,
        notes: input.notes ?? null,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        status: 'proposed',
      });
      return plans.propose({
        planId: plan.id,
        coupleId,
        proposedBy: profileId,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.proposals(coupleId) });
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
    },
  });
}

export function useCompletePlan(coupleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { planId: string; completed: boolean }) =>
      plans.setPlanStatus(input.planId, input.completed ? 'completed' : 'skipped'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
      void client.invalidateQueries({ queryKey: keys.cadences(coupleId) });
    },
  });
}

/**
 * Live updates for the propose/respond loop.
 *
 * Without this, a partner's reply only appears on the next manual refresh —
 * and the whole point of the loop is that the other person sees it.
 *
 * Every subscription carries a `filter`. On `plans` it is the domain, which is
 * the boundary RLS cannot express and the one thing keeping the two apps'
 * rows apart; on the other two it is the couple, which RLS already enforces
 * but which costs nothing to say twice. `postgres_changes` accepts a single
 * `column=op.value`, so each table gets the filter that does the most work —
 * and `plan_proposals` has no `domain` column to filter on anyway.
 */
export function useRealtimeSync(coupleId: string | null): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!coupleId) return;

    const channel = supabase
      .channel(`couple:${coupleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'plans', filter: `domain=eq.${DOMAIN}` },
        () => {
          void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'plan_proposals',
          filter: `couple_id=eq.${coupleId}`,
        },
        () => {
          void client.invalidateQueries({ queryKey: keys.proposals(coupleId) });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checkins', filter: `couple_id=eq.${coupleId}` },
        () => {
          void client.invalidateQueries({ queryKey: ['checkins', coupleId] });
        },
      )
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
