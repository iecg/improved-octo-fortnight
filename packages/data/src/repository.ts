/**
 * Domain-scoped access to cadences, plans, and proposals.
 *
 * This module is where the boundary between the two apps is enforced.
 * Row-level security cannot express it: both partners are legitimate members
 * of the couple, so the database has no basis to hide `domain = 'intimacy'`
 * rows from the 2-2-2 app. What keeps them apart is that there is no way to
 * reach a plan without first naming a domain — the factory takes one, every
 * read filters on it, and every write stamps it.
 *
 * Consequently: do not export a raw table client from this package, and do not
 * add a method that takes `domain` as a per-call argument.
 */
import type {
  AppDomain,
  Cadence,
  IntervalUnit,
  Plan,
  PlanProposal,
  PlanStatus,
} from '@couple/core';

import type { AppSupabaseClient } from './client';
import { toCadence, toPlan, toPlanProposal } from './mappers';

export interface CreatePlanInput {
  coupleId: string;
  kind: string;
  createdBy: string;
  title?: string | null;
  notes?: string | null;
  location?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: PlanStatus;
}

export interface ProposeInput {
  planId: string;
  coupleId: string;
  proposedBy: string;
  startsAt: string;
  endsAt: string;
  /** Set when this is a counter-offer, forming a chain back through the negotiation. */
  counteredFrom?: string | null;
}

export interface DomainRepository {
  readonly domain: AppDomain;

  listCadences(coupleId: string): Promise<Cadence[]>;
  upsertCadence(input: {
    coupleId: string;
    kind: string;
    intervalValue: number;
    intervalUnit: IntervalUnit;
    enabled?: boolean;
  }): Promise<Cadence>;
  setCadenceEnabled(cadenceId: string, enabled: boolean): Promise<void>;

  listPlans(coupleId: string): Promise<Plan[]>;
  getPlan(planId: string): Promise<Plan | null>;
  createPlan(input: CreatePlanInput): Promise<Plan>;
  updatePlan(planId: string, patch: Partial<CreatePlanInput>): Promise<Plan>;
  setPlanStatus(planId: string, status: PlanStatus, completedAt?: string | null): Promise<Plan>;
  recordCalendarEvent(plan: Plan, profileId: string, eventId: string | null): Promise<Plan>;
  deletePlan(planId: string): Promise<void>;

  listProposals(coupleId: string): Promise<PlanProposal[]>;
  listPendingProposals(coupleId: string): Promise<PlanProposal[]>;
  propose(input: ProposeInput): Promise<PlanProposal>;
  respond(proposalId: string, response: 'accepted' | 'declined' | 'countered'): Promise<void>;
}

export function createDomainRepository(
  client: AppSupabaseClient,
  domain: AppDomain,
): DomainRepository {
  return {
    domain,

    async listCadences(coupleId) {
      const { data, error } = await client
        .from('cadences')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('domain', domain)
        .order('kind');
      if (error) throw new Error(error.message);
      return (data ?? []).map(toCadence);
    },

    async upsertCadence(input) {
      const { data, error } = await client
        .from('cadences')
        .upsert(
          {
            couple_id: input.coupleId,
            domain,
            kind: input.kind,
            interval_value: input.intervalValue,
            interval_unit: input.intervalUnit,
            enabled: input.enabled ?? true,
          },
          { onConflict: 'couple_id,domain,kind' },
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toCadence(data);
    },

    async setCadenceEnabled(cadenceId, enabled) {
      const { error } = await client
        .from('cadences')
        .update({ enabled })
        .eq('id', cadenceId)
        .eq('domain', domain);
      if (error) throw new Error(error.message);
    },

    async listPlans(coupleId) {
      const { data, error } = await client
        .from('plans')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('domain', domain)
        .order('starts_at', { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map(toPlan);
    },

    async getPlan(planId) {
      const { data, error } = await client
        .from('plans')
        .select('*')
        .eq('id', planId)
        .eq('domain', domain)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toPlan(data) : null;
    },

    async createPlan(input) {
      const { data, error } = await client
        .from('plans')
        .insert({
          couple_id: input.coupleId,
          domain,
          kind: input.kind,
          created_by: input.createdBy,
          title: input.title ?? null,
          notes: input.notes ?? null,
          location: input.location ?? null,
          starts_at: input.startsAt ?? null,
          ends_at: input.endsAt ?? null,
          status: input.status ?? 'idea',
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPlan(data);
    },

    async updatePlan(planId, patch) {
      const { data, error } = await client
        .from('plans')
        .update({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.location !== undefined ? { location: patch.location } : {}),
          ...(patch.startsAt !== undefined ? { starts_at: patch.startsAt } : {}),
          ...(patch.endsAt !== undefined ? { ends_at: patch.endsAt } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        })
        .eq('id', planId)
        .eq('domain', domain)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPlan(data);
    },

    async setPlanStatus(planId, status, completedAt) {
      const { data, error } = await client
        .from('plans')
        .update({
          status,
          // Completing anchors the cadence, so the timestamp matters; every
          // other transition clears it.
          completed_at: status === 'completed' ? (completedAt ?? new Date().toISOString()) : null,
        })
        .eq('id', planId)
        .eq('domain', domain)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPlan(data);
    },

    async recordCalendarEvent(plan, profileId, eventId) {
      // Each partner's phone returns its own identifier for the same logical
      // event, so this is a merge into the existing map rather than a write.
      const next = { ...plan.calendarEventIds };
      if (eventId === null) delete next[profileId];
      else next[profileId] = eventId;

      const { data, error } = await client
        .from('plans')
        .update({ calendar_event_ids: next })
        .eq('id', plan.id)
        .eq('domain', domain)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPlan(data);
    },

    async deletePlan(planId) {
      const { error } = await client.from('plans').delete().eq('id', planId).eq('domain', domain);
      if (error) throw new Error(error.message);
    },

    async listProposals(coupleId) {
      const { data, error } = await client
        .from('plan_proposals')
        .select('*, plans!inner(domain)')
        .eq('couple_id', coupleId)
        .eq('plans.domain', domain)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map(toPlanProposal);
    },

    async listPendingProposals(coupleId) {
      const { data, error } = await client
        .from('plan_proposals')
        .select('*, plans!inner(domain)')
        .eq('couple_id', coupleId)
        .eq('plans.domain', domain)
        .eq('response', 'pending')
        .order('starts_at');
      if (error) throw new Error(error.message);
      return (data ?? []).map(toPlanProposal);
    },

    async propose(input) {
      const { data, error } = await client
        .from('plan_proposals')
        .insert({
          plan_id: input.planId,
          couple_id: input.coupleId,
          proposed_by: input.proposedBy,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          countered_from: input.counteredFrom ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPlanProposal(data);
    },

    async respond(proposalId, response) {
      // `responded_by` and `responded_at` are stamped by a trigger, which also
      // rejects answering your own proposal.
      const { error } = await client
        .from('plan_proposals')
        .update({ response })
        .eq('id', proposalId);
      if (error) throw new Error(error.message);
    },
  };
}
