/**
 * Upcoming outings and what already happened.
 *
 * Completing a plan is what re-anchors its cadence, so the actions here are the
 * only things that move the clocks on the rhythm screen — with one exception.
 * Moving a booking to another day changes when it is, and nothing else: the
 * clock stays where it was, because nothing has happened yet.
 */
import { groupPlans } from '@couple/cadence';
import type { Plan, PlanPlace } from '@couple/core';
import { formatDay, formatWindowParts } from '@couple/i18n';
import {
  Body,
  Button,
  Card,
  Disclosure,
  Divider,
  Heading,
  Loading,
  Muted,
  Screen,
  Title,
} from '@couple/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { DaySheet } from '../../src/DaySheet';
import { PlanPlaceCard } from '../../src/features/places/PlanPlace';
import {
  useAttachPlace,
  useCompletePlan,
  useDetachPlace,
  usePlaces,
  usePlans,
  useReschedulePlan,
  useSetPlaceCalendarSharing,
} from '../../src/queries';
import { usePairedSession } from '../../src/session';

export default function Plans() {
  const { t, i18n } = useTranslation(['app', 'common', 'plans', 'places']);
  const { profile, couple } = usePairedSession();
  const router = useRouter();

  const now = useMemo(() => new Date(), []);
  const locale = i18n.language === 'es' ? 'es' : 'en';
  const timeZone = couple.timezone;

  const plansQuery = usePlans(couple.id);
  const complete = useCompletePlan(couple.id);
  const placesQuery = usePlaces(couple.id);
  const attach = useAttachPlace(couple.id, profile.id);
  const detach = useDetachPlace(couple.id);
  const share = useSetPlaceCalendarSharing(couple.id);
  const reschedule = useReschedulePlan(couple.id, timeZone);

  /**
   * The plan being moved, and the day the sheet is currently showing.
   *
   * One sheet for the whole screen rather than one per row: the picker is a
   * native view 360pt tall, and mounting a hidden one under every plan is a
   * cost paid on every render for a control used once.
   */
  const [moving, setMoving] = useState<{ plan: Plan; day: Date } | null>(null);

  const placeByPlan = useMemo(() => {
    const map = new Map<string, PlanPlace>();
    for (const place of placesQuery.data ?? []) {
      if (place.planId) map.set(place.planId, place);
    }
    return map;
  }, [placesQuery.data]);

  // Grouped by the pure engine, so this app and the other one cannot disagree
  // about what counts as behind — and so the group that used to be missing
  // entirely has a test on it.
  const { needsAnswer, upcoming, history } = useMemo(
    () => groupPlans(plansQuery.data ?? [], now),
    [plansQuery.data, now],
  );

  function label(plan: Plan): string {
    if (!plan.startsAt) return t('common:state.empty');
    if (!plan.endsAt) return formatDay(new Date(plan.startsAt), locale, timeZone);
    const parts = formatWindowParts(
      new Date(plan.startsAt),
      new Date(plan.endsAt),
      locale,
      timeZone,
    );
    return t('plans:proposal.window', { start: parts.start, end: parts.end });
  }

  /**
   * The three answers a booking can have, identical in both groups.
   *
   * Moving is third and full width rather than a third of a row: at three
   * across, "Marcar como hecho" wraps to two lines and the row grows to match.
   * Ghost, because it is the answer that decides nothing — which is also why it
   * has to be here. Without it the only replies were "done" and "didn't
   * happen", so a night that simply moved had to be filed as a failure.
   */
  function actions(plan: Plan) {
    return (
      <View className="gap-2">
        <View className="flex-row gap-2">
          <View className="grow basis-0">
            <Button
              label={t('plans:detail.markDone')}
              variant="secondary"
              onPress={() => complete.mutate({ planId: plan.id, completed: true })}
            />
          </View>
          <View className="grow basis-0">
            <Button
              label={t('plans:detail.markSkipped')}
              variant="ghost"
              onPress={() => complete.mutate({ planId: plan.id, completed: false })}
            />
          </View>
        </View>
        {/* A plan with no date has nothing to move. */}
        {plan.startsAt ? (
          <Button
            label={t('plans:detail.move')}
            variant="ghost"
            onPress={() => setMoving({ plan, day: new Date(plan.startsAt as string) })}
          />
        ) : null}
      </View>
    );
  }

  if (plansQuery.isLoading) return <Loading />;

  return (
    <Screen tabbed>
      <Title>{t('common:tabs.plans')}</Title>

      {/*
        First, because it is the only thing here anyone is blocked on — and
        because until now it was nowhere at all. A plan still booked after its
        own end time matched neither list and disappeared, taking with it the
        only control that re-anchors its cadence. The wording is a question
        rather than a nag: "didn't happen" is an answer, not a failure.
      */}
      {needsAnswer.length > 0 ? (
        <Card>
          <View className="gap-2">
            <Heading>{t('plans:list.needsAnswer')}</Heading>
            {needsAnswer.map((plan, index) => (
              <View key={plan.id} className="gap-2 py-2">
                {index > 0 ? <Divider /> : null}
                <Pressable className="gap-2" onPress={() => router.push(`/plan/${plan.id}`)}>
                  {plan.title ? <Body>{plan.title}</Body> : null}
                  <Muted>{label(plan)}</Muted>
                </Pressable>
                {actions(plan)}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <View className="gap-2">
          <Heading>{t('plans:list.upcoming')}</Heading>
          {upcoming.length === 0 ? <Muted>{t('plans:list.emptyUpcoming')}</Muted> : null}
          {upcoming.map((plan, index) => (
            <View key={plan.id} className="gap-2 py-2">
              {index > 0 ? <Divider /> : null}
              {/* Tapping the plan opens it in full; the place and action
                  controls below stay their own targets. Written by a partner,
                  shown exactly as written. */}
              <Pressable className="gap-2" onPress={() => router.push(`/plan/${plan.id}`)}>
                {plan.title ? <Body>{plan.title}</Body> : null}
                <Muted>{label(plan)}</Muted>
              </Pressable>
              <PlanPlaceCard
                plan={plan}
                place={placeByPlan.get(plan.id) ?? null}
                locale={locale}
                timeZone={timeZone}
                busy={attach.isPending || detach.isPending}
                onAttach={(draft) => attach.mutate({ plan, place: { ...draft, locale } })}
                onRemove={() => {
                  const place = placeByPlan.get(plan.id);
                  if (place) detach.mutate({ placeId: place.id, plan });
                }}
                onShareWithCalendar={(next) => {
                  const place = placeByPlan.get(plan.id);
                  if (place) share.mutate({ placeId: place.id, share: next });
                }}
              />
              {actions(plan)}
            </View>
          ))}
        </View>
      </Card>

      {/* A record, and only ever looked up. Closed. */}
      <Disclosure label={t('plans:list.history')}>
        <Card>
          <View className="gap-2">
            {history.length === 0 ? <Muted>{t('plans:list.emptyHistory')}</Muted> : null}
            {history.map((plan, index) => (
              <View key={plan.id} className="gap-1 py-2">
                {index > 0 ? <Divider /> : null}
                <Pressable className="gap-1" onPress={() => router.push(`/plan/${plan.id}`)}>
                  {plan.title ? <Body>{plan.title}</Body> : null}
                  <Muted>{label(plan)}</Muted>
                </Pressable>
                <Muted>{t(`plans:status.${plan.status}`)}</Muted>
              </View>
            ))}
          </View>
        </Card>
      </Disclosure>

      {/*
        Closing the sheet is what commits, the same as it is when booking: the
        picker has no other confirm step, and asking twice for one date is the
        friction this pass exists to remove. `minimumDate` is now, because
        moving something into the past is the one answer that cannot be meant.
      */}
      {moving ? (
        <DaySheet
          visible
          value={moving.day}
          minimumDate={now}
          label={t('plans:detail.move')}
          onChange={(day) => setMoving({ plan: moving.plan, day })}
          onClose={() => {
            reschedule.mutate({ plan: moving.plan, day: moving.day });
            setMoving(null);
          }}
        />
      ) : null}
    </Screen>
  );
}
