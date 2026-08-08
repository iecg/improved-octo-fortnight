/**
 * The plan and cadence queries both apps run, said once.
 *
 * Reading a couple's plans, reading their cadences, seeding the cadences on
 * first launch, marking a plan done, pausing a cadence: every one of these was
 * written twice, identically apart from a domain constant. Two copies of a
 * cache-invalidation rule is the kind of duplication that does not announce
 * itself when it drifts — one app gains an `invalidateQueries` and the other
 * quietly keeps showing a stale countdown.
 *
 * ## Why this takes a repository rather than a domain
 *
 * Invariant 2 forbids a method that takes `domain` as a per-call argument, and
 * a factory taking one at construction is the sanctioned shape — the same shape
 * `createDomainRepository` itself uses. This goes one further and takes no
 * domain at all: it is handed a repository that already carries one, and reads
 * `repo.domain` for the cache keys. There is therefore no argument a caller
 * could pass that would make it read the other app's rows, and no way for the
 * key and the repository to disagree about which app's cache is being written.
 *
 * ## What is deliberately not here
 *
 * `useServerBusy`, above all. Both apps read `plan_busy_times`, and they are
 * *supposed* to differ: the 2-2-2 app gates it on a device-local setting that
 * starts off, the intimacy app does not, because what it discloses in that
 * direction is that a date night is booked. Hoisting it would put a single
 * default on a decision the two apps are meant to answer differently, and the
 * one that starts closed is the one that would lose.
 *
 * Realtime is also absent: the two subscriptions differ in table, filter and
 * channel name, and each of those differences is load-bearing and commented
 * where it lives. So are proposals (intimacy only), ideas and places (2-2-2
 * only), and the two booking mutations, which take different inputs because
 * one app proposes a time and the other books one.
 */
import type { KindDefinition } from '@couple/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { DomainRepository } from './repository';

/**
 * Cache keys for everything below, exposed because the per-app hooks build on
 * them: rescheduling invalidates `busyAll`, proposing invalidates `plans`.
 * Domain-scoped so the two apps' caches cannot collide, except `busy`, which is
 * the same list either app would read.
 */
export interface PlanQueryKeys {
  plans: (coupleId: string) => readonly unknown[];
  plan: (planId: string) => readonly unknown[];
  cadences: (coupleId: string) => readonly unknown[];
  busy: (coupleId: string, from: string, to: string) => readonly unknown[];
  /**
   * Every bounds pair for a couple. The bounds are part of `busy`'s key, so
   * invalidating one window would leave every other range stale.
   */
  busyAll: (coupleId: string) => readonly unknown[];
}

export function createPlanQueries(repo: DomainRepository, defaultCadences: KindDefinition[]) {
  const domain = repo.domain;

  const keys: PlanQueryKeys = {
    plans: (coupleId) => ['plans', domain, coupleId] as const,
    plan: (planId) => ['plan', domain, planId] as const,
    cadences: (coupleId) => ['cadences', domain, coupleId] as const,
    // Not domain-keyed: this list is the same one either app would read.
    busy: (coupleId, from, to) => ['busy', coupleId, from, to] as const,
    busyAll: (coupleId) => ['busy', coupleId] as const,
  };

  function usePlans(coupleId: string) {
    return useQuery({ queryKey: keys.plans(coupleId), queryFn: () => repo.listPlans(coupleId) });
  }

  function useGetPlan(planId: string) {
    return useQuery({ queryKey: keys.plan(planId), queryFn: () => repo.getPlan(planId) });
  }

  function useCadences(coupleId: string) {
    return useQuery({
      queryKey: keys.cadences(coupleId),
      queryFn: () => repo.listCadences(coupleId),
    });
  }

  /**
   * Seed this app's standing rituals from its own kind catalog.
   *
   * Deliberately not a database trigger — a trigger on `couples` would give
   * every couple every app's cadences whichever app they actually installed.
   * The catalog is the one thing that genuinely differs between the two, which
   * is why it is a constructor argument rather than something read from here.
   * Idempotent, because `upsertCadence` upserts on `(couple_id, domain, kind)`.
   */
  async function seedCadences(coupleId: string): Promise<void> {
    for (const kind of defaultCadences) {
      await repo.upsertCadence({
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
   * second one never passes through the pairing screen — and that screen was
   * the only thing that had ever called `seedCadences`. Without this the second
   * app opens to an empty rhythm and there is no other way to create a cadence.
   *
   * Only a genuinely empty list seeds. A ritual switched off keeps its row with
   * `enabled = false`, so turning one off never resurrects it here.
   */
  function useEnsureCadences(coupleId: string): void {
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
   * The answer to "did this happen", either way.
   *
   * Completing is the only thing that re-anchors a cadence, which is why the
   * cadence list is invalidated alongside the plans — the countdown on the
   * other screen is wrong the instant this returns.
   */
  function useCompletePlan(coupleId: string) {
    const client = useQueryClient();
    return useMutation({
      mutationFn: (input: { planId: string; completed: boolean }) =>
        repo.setPlanStatus(input.planId, input.completed ? 'completed' : 'skipped'),
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
        void client.invalidateQueries({ queryKey: keys.cadences(coupleId) });
      },
    });
  }

  /**
   * Pause a ritual, or bring it back.
   *
   * A paused cadence keeps its row with `enabled = false` rather than being
   * deleted, which is what lets `useEnsureCadences` tell "never seeded" from
   * "switched off" — and what stops a pause being silently undone on next
   * launch. The plans already made under it stay where they are: this turns off
   * a countdown, not a history.
   */
  function useSetCadenceEnabled(coupleId: string) {
    const client = useQueryClient();
    return useMutation({
      mutationFn: (input: { cadenceId: string; enabled: boolean }) =>
        repo.setCadenceEnabled(input.cadenceId, input.enabled),
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: keys.cadences(coupleId) });
      },
    });
  }

  return {
    keys,
    usePlans,
    useGetPlan,
    useCadences,
    seedCadences,
    useEnsureCadences,
    useCompletePlan,
    useSetCadenceEnabled,
  };
}

export type PlanQueries = ReturnType<typeof createPlanQueries>;
