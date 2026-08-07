/**
 * Upcoming outings and what already happened.
 *
 * Completing a plan is what re-anchors its cadence, so the two actions here
 * are the only things that move the clocks on the rhythm screen.
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
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { PlanPlaceCard } from '../../src/features/places/PlanPlace';
import {
  useAttachPlace,
  useCompletePlan,
  useDetachPlace,
  usePlaces,
  usePlans,
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

  if (plansQuery.isLoading) return <Loading />;

  return (
    <Screen tabbed>
      <Title>{t('app:tabs.plans')}</Title>

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
    </Screen>
  );
}
