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
import type { Cadence, Coordinates, IdeaSource, Locale, PlaceProvider, Plan } from '@couple/core';
import { createDomainRepository, createIdeaRepository, createPlaceRepository } from '@couple/data';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { placeLabel } from '../features/places/label';
import { supabase } from './runtime';

export const DOMAIN = 'two_two_two' as const;

export const plans = createDomainRepository(supabase, DOMAIN);

/** 2-2-2-owned. Its own factory, so the intimacy app has nothing to import. */
export const ideas = createIdeaRepository(supabase);

/** Also 2-2-2-owned, and also without a domain parameter. */
export const places = createPlaceRepository(supabase);

const keys = {
  plans: (coupleId: string) => ['plans', DOMAIN, coupleId] as const,
  cadences: (coupleId: string) => ['cadences', DOMAIN, coupleId] as const,
  ideas: (coupleId: string) => ['ideas', DOMAIN, coupleId] as const,
  places: (coupleId: string) => ['places', DOMAIN, coupleId] as const,
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
    mutationFn: async (input: {
      kind: string;
      title: string | null;
      startsAt: Date;
      endsAt: Date;
      /** Optional, and independent of whether any mapping provider exists. */
      place?: AttachPlaceDraft | null;
    }) => {
      const plan = await plans.createPlan({
        coupleId,
        kind: input.kind,
        createdBy: profileId,
        // Partner-authored, stored and shown verbatim in whatever language it
        // was written.
        title: input.title,
        // The label, not the coordinates. This column is the one that can reach
        // a device calendar.
        location: input.place ? placeLabel(input.place.name, input.place.address) : null,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        status: 'scheduled',
      });

      if (input.place) {
        await places.attach({
          coupleId,
          attachedBy: profileId,
          planId: plan.id,
          name: input.place.name,
          address: input.place.address ?? null,
          provider: input.place.provider,
          providerPlaceId: input.place.providerPlaceId ?? null,
          coordinates: input.place.coordinates ?? null,
          locale: input.place.locale,
          shareWithCalendar: input.place.shareWithCalendar ?? false,
        });
      }

      return plan;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
      void client.invalidateQueries({ queryKey: keys.cadences(coupleId) });
      void client.invalidateQueries({ queryKey: keys.places(coupleId) });
    },
  });
}

/**
 * A place as a screen has it, before it belongs to anything.
 *
 * `provider: 'manual'` with no coordinates is the whole of this in an app with
 * nothing configured; a searched place fills in the remaining fields.
 */
export interface AttachPlaceDraft {
  name: string;
  address?: string | null;
  provider: PlaceProvider;
  providerPlaceId?: string | null;
  coordinates?: Coordinates | null;
  locale: Locale;
  shareWithCalendar?: boolean;
}

export function usePlaces(coupleId: string) {
  return useQuery({
    queryKey: keys.places(coupleId),
    queryFn: () => places.listForCouple(coupleId),
  });
}

/**
 * Attach a place to a plan that already exists, and project its label onto
 * `plans.location` in the same step.
 *
 * The two writes are deliberately here rather than inside the repository: the
 * label is what can reach a calendar entry, so it is written where someone
 * reading a screen can see it happen.
 */
export function useAttachPlace(coupleId: string, profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planId: string; place: AttachPlaceDraft }) => {
      const attached = await places.attach({
        coupleId,
        attachedBy: profileId,
        planId: input.planId,
        name: input.place.name,
        address: input.place.address ?? null,
        provider: input.place.provider,
        providerPlaceId: input.place.providerPlaceId ?? null,
        coordinates: input.place.coordinates ?? null,
        locale: input.place.locale,
        shareWithCalendar: input.place.shareWithCalendar ?? false,
      });
      await plans.updatePlan(input.planId, {
        location: placeLabel(input.place.name, input.place.address),
      });
      return attached;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.places(coupleId) });
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
    },
  });
}

export function useDetachPlace(coupleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { placeId: string; planId: string | null }) => {
      await places.detach(input.placeId);
      // Leaving the label behind would keep a removed place in the calendar.
      if (input.planId) await plans.updatePlan(input.planId, { location: null });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.places(coupleId) });
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
    },
  });
}

export function useSetPlaceCalendarSharing(coupleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { placeId: string; share: boolean }) =>
      places.setShareWithCalendar(input.placeId, input.share),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.places(coupleId) });
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
      source: IdeaSource;
      locale: Locale;
    }) =>
      ideas.save({
        coupleId,
        kind: input.kind,
        savedBy: profileId,
        title: input.title,
        summary: input.summary ?? null,
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

export function useRealtimeSync(coupleId: string | null): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!coupleId) return;
    const channel = supabase
      .channel(`two22:${coupleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, () => {
        void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
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
