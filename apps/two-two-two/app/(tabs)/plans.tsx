/**
 * Upcoming outings and what already happened.
 *
 * Completing a plan is what re-anchors its cadence, so the two actions here
 * are the only things that move the clocks on the rhythm screen.
 */
import type { Plan, PlanPlace } from '@couple/core';
import { formatDay, formatWindowParts } from '@couple/i18n';
import { Body, Button, Card, Divider, Heading, Loading, Muted, Screen, Title } from '@couple/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

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

  const { upcoming, history } = useMemo(() => {
    const all = plansQuery.data ?? [];
    return {
      upcoming: all
        .filter((p) => p.status === 'scheduled' && p.startsAt && new Date(p.startsAt) >= now)
        .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
      history: all.filter((p) => p.status === 'completed' || p.status === 'skipped').slice(0, 20),
    };
  }, [plansQuery.data, now]);

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
    <Screen>
      <Title>{t('app:tabs.plans')}</Title>

      <Card>
        <View className="gap-2">
          <Heading>{t('plans:list.upcoming')}</Heading>
          {upcoming.length === 0 ? <Muted>{t('plans:list.emptyUpcoming')}</Muted> : null}
          {upcoming.map((plan, index) => (
            <View key={plan.id} className="gap-2 py-2">
              {index > 0 ? <Divider /> : null}
              {/* Written by a partner, shown exactly as written. */}
              {plan.title ? <Body>{plan.title}</Body> : null}
              <Muted>{label(plan)}</Muted>
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

      <Card>
        <View className="gap-2">
          <Heading>{t('plans:list.history')}</Heading>
          {history.length === 0 ? <Muted>{t('plans:list.emptyHistory')}</Muted> : null}
          {history.map((plan, index) => (
            <View key={plan.id} className="gap-1 py-2">
              {index > 0 ? <Divider /> : null}
              {plan.title ? <Body>{plan.title}</Body> : null}
              <Muted>{label(plan)}</Muted>
              <Muted>{t(`plans:status.${plan.status}`)}</Muted>
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
