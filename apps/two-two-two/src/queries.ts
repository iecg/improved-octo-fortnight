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
import { shiftToDay } from '@couple/cadence';
import type { Coordinates, CostBand, IdeaSource, Locale, PlaceProvider, Plan } from '@couple/core';
import {
  createBusyRepository,
  createDomainRepository,
  createIdeaRepository,
  createPlaceRepository,
  createPlanQueries,
} from '@couple/data';
import { isCrossAppBusyEnabled, setCrossAppBusyEnabled } from '@couple/device';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { placeLabel } from './features/places/label';
import { contentCipher, DEFAULT_CADENCES, supabase } from './runtime';

export const DOMAIN = 'two_two_two' as const;

export const plans = createDomainRepository(supabase, DOMAIN, contentCipher);

/** 2-2-2-owned. Its own factory, so the intimacy app has nothing to import. */
export const ideas = createIdeaRepository(supabase, contentCipher);

/** Also 2-2-2-owned, and also without a domain parameter. */
export const places = createPlaceRepository(supabase, contentCipher);

/**
 * Times the couple is occupied, across both apps — and only times.
 *
 * The one accessor here that is not domain-scoped, because the view behind it
 * has no domain to scope to. Gated on a setting; see `useServerBusy`.
 */
export const busy = createBusyRepository(supabase);

/**
 * Everything both apps do with plans and cadences, from the shared factory.
 *
 * It is given the repository rather than a domain, so there is no argument here
 * that could point it at the intimacy app's rows. What stays below is this
 * app's own: the shortlist, places, booking outright rather than proposing, and
 * the cross-app busy gate.
 */
const shared = createPlanQueries(plans, DEFAULT_CADENCES);

export const {
  usePlans,
  useGetPlan,
  useCadences,
  seedCadences,
  useEnsureCadences,
  useCompletePlan,
  useSetCadenceEnabled,
} = shared;

/**
 * The shared keys plus this app's own, so nothing below has to know which is
 * which — and so `plans` and `cadences` cannot be spelled one way in the shared
 * factory's invalidations and another way here.
 */
const keys = {
  ...shared.keys,
  ideas: (coupleId: string) => ['ideas', DOMAIN, coupleId] as const,
  places: (coupleId: string) => ['places', DOMAIN, coupleId] as const,
  // Device-local, so not keyed by couple: it describes this phone.
  crossAppBusy: () => ['preferences', 'crossAppBusy'] as const,
};

/**
 * Whether this device may see times the couple is busy in the other app.
 *
 * A query rather than a `useState` seeded by an effect, so that flipping the
 * switch in Settings reaches every mounted reader at once. The effect version
 * ran with `[]` deps and read the keychain exactly once per mount: the toggle
 * changed the stored value and nothing already on screen ever heard about it.
 * That was survivable only because the one consumer is a modal that remounts.
 *
 * `initialData: false` is the gate, not an optimisation. The query starts
 * closed, so nothing reads across the boundary in the window before the
 * keychain answers.
 */
export function useCrossAppBusyEnabled() {
  return useQuery({
    queryKey: keys.crossAppBusy(),
    queryFn: isCrossAppBusyEnabled,
    initialData: false,
    staleTime: Infinity,
  });
}

/** The switch in Settings. Writes the keychain, then tells every reader. */
export function useSetCrossAppBusyEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: setCrossAppBusyEnabled,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.crossAppBusy() });
    },
  });
}

/**
 * Occupied windows from the server, if the reader has asked for them.
 *
 * The setting is read *here*, not passed in by the caller. This is the only
 * door to the one accessor that crosses the domain boundary, so the gate
 * belongs on it — a second screen wanting busy times later cannot forget to
 * check, because there is nothing for it to forget.
 *
 * It starts closed. Until the preference resolves, and forever after if it
 * resolves false, the query does not run and no intimacy row is read.
 *
 * The bounds are part of the key so a screen that widens its range refetches
 * rather than quietly reusing a narrower answer.
 *
 * What realtime cannot keep fresh: this app subscribes to `plans` filtered to
 * its own domain, deliberately, so a booking made in the *other* app does not
 * arrive here — the filter is the domain boundary. Those windows are picked up
 * the next time a screen mounts with a fresh range. Widening the subscription
 * to hear about them would deliver the very rows the boundary exists to keep
 * out.
 */
export function useServerBusy(coupleId: string, from: Date, to: Date) {
  const { data: enabled } = useCrossAppBusyEnabled();

  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery({
    queryKey: keys.busy(coupleId, fromIso, toIso),
    queryFn: () => busy.listBetween(coupleId, from, to),
    enabled,
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
    // Takes the plan rather than its id, because the label it writes is a
    // sealed field now: `updatePlanContent` has to open the existing payload,
    // merge, and re-seal, so the caller must be holding the row.
    mutationFn: async (input: { plan: Plan; place: AttachPlaceDraft }) => {
      const attached = await places.attach({
        coupleId,
        attachedBy: profileId,
        planId: input.plan.id,
        name: input.place.name,
        address: input.place.address ?? null,
        provider: input.place.provider,
        providerPlaceId: input.place.providerPlaceId ?? null,
        coordinates: input.place.coordinates ?? null,
        locale: input.place.locale,
        shareWithCalendar: input.place.shareWithCalendar ?? false,
      });
      await plans.updatePlanContent(input.plan, {
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
    mutationFn: async (input: { placeId: string; plan: Plan | null }) => {
      await places.detach(input.placeId);
      // Leaving the label behind would keep a removed place in the calendar.
      if (input.plan) await plans.updatePlanContent(input.plan, { location: null });
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

/**
 * Move a booking to another day, keeping everything else about it.
 *
 * The third answer this app was missing. "Done" and "didn't happen" are both
 * terminal, so a night that simply moved had to be recorded as a failure and
 * booked again from scratch — and until then it sat in "Did this happen?"
 * reading as a reproach.
 *
 * Shifted by whole calendar days rather than by a duration: the day is the only
 * thing the sheet asks about, and stepping both ends through `addInterval` in
 * the couple's timezone keeps the start hour, the end hour and the number of
 * nights exactly as they were across a DST boundary. Adding a millisecond delta
 * instead would move a 9am departure to 10am twice a year.
 *
 * The status is untouched on purpose. A moved plan is still `scheduled`, which
 * is what takes it back out of the needs-an-answer group without pretending
 * anything happened — and what keeps its cadence unanchored, because only
 * completing anchors one.
 */
export function useReschedulePlan(coupleId: string, timeZone: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { plan: Plan; day: Date }) => {
      const startsAt = input.plan.startsAt;
      if (!startsAt) throw new Error('a plan with no date cannot be moved');

      // Opening the sheet and closing it again is not an edit, and `shiftToDay`
      // says so with `null`. Without that the no-op writes a row, bumps
      // `updated_at`, and pushes a calendar rewrite to both phones for a plan
      // nobody moved.
      const moved = shiftToDay({ startsAt, endsAt: input.plan.endsAt }, input.day, timeZone);
      if (!moved) return input.plan;

      return plans.setPlanSchedule(input.plan.id, moved);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.plans(coupleId) });
      // The rhythm screen reads `nextScheduledAt` off the plans, and the
      // propose screen's free/busy marks are wrong the moment a window moves.
      void client.invalidateQueries({ queryKey: keys.cadences(coupleId) });
      void client.invalidateQueries({ queryKey: keys.busyAll(coupleId) });
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
    mutationFn: async (input: {
      kind: string;
      title: string;
      summary?: string | null;
      /** Only suggestions carry one; the library and manual entry leave it null. */
      estCostBand?: CostBand | null;
      source: IdeaSource;
      /** Which provider named it, for the sources that came from one. */
      sourceDomain?: string | null;
      locale: Locale;
      /**
       * A real venue behind the idea, when it came from a map.
       *
       * Kept as a row rather than flattened into `summary`, so the coordinates
       * and the provider's id survive: without them a shortlisted venue is a
       * sentence, and booking it later cannot carry a map, a drive time, or a
       * stay search through.
       */
      place?: AttachPlaceDraft | null;
    }) => {
      const idea = await ideas.save({
        coupleId,
        kind: input.kind,
        savedBy: profileId,
        title: input.title,
        summary: input.summary ?? null,
        estCostBand: input.estCostBand ?? null,
        source: input.source,
        sourceDomain: input.sourceDomain ?? null,
        locale: input.locale,
      });

      if (input.place) {
        await places.attach({
          coupleId,
          attachedBy: profileId,
          ideaId: idea.id,
          name: input.place.name,
          address: input.place.address ?? null,
          provider: input.place.provider,
          providerPlaceId: input.place.providerPlaceId ?? null,
          coordinates: input.place.coordinates ?? null,
          locale: input.place.locale,
        });
      }

      return idea;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.ideas(coupleId) });
      void client.invalidateQueries({ queryKey: keys.places(coupleId) });
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
          void client.invalidateQueries({ queryKey: keys.busyAll(coupleId) });
        },
      )
      // The shortlist is shared, and both partners read it while deciding what
      // to book. Requires `plan_ideas` in the `supabase_realtime` publication —
      // `tests/guards/realtime-subscriptions.test.ts` holds the two together.
      // Unfiltered on purpose; see the note above about deletes.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_ideas' }, () => {
        void client.invalidateQueries({ queryKey: keys.ideas(coupleId) });
      })
      // Where a plan is happening is as shared as when it is happening.
      //
      // Attaching a place also writes `plans.location`, so the plans channel
      // above already fires — but that only refreshes the label, leaving the
      // other phone with the plan's new location and a stale place list, and no
      // name, address or map to show beside it. Toggling the calendar opt-in
      // does not touch `plans` at all. Subscribing directly is the version with
      // no cases in it.
      //
      // Unfiltered, like `plan_ideas` and for the same reason: a place is
      // deleted from a screen (`useDetachPlace`), and under the default replica
      // identity a delete carries only the primary key — so a filter on
      // anything else would silently drop it and leave a removed place on the
      // other phone forever. This table is 2-2-2-owned outright, so there is no
      // boundary a filter would be protecting.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_places' }, () => {
        void client.invalidateQueries({ queryKey: keys.places(coupleId) });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [client, coupleId]);
}
