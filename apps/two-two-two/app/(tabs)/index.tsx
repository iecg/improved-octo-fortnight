/**
 * The rhythm screen: one clock per commitment.
 *
 * The whole point of the 2-2-2 rule is that nobody tracks the interval — you
 * notice it has been four months only in hindsight. This is that noticing,
 * made visible.
 *
 * Every countdown comes from the shared cadence engine, the same pure code the
 * intimacy app runs. Only the intervals differ.
 */
import { healthLabelKey } from '@couple/cadence';
import { kindDescriptionKey, kindLabelKey, type AppDomain } from '@couple/core';
import { dueTranslation, formatDay } from '@couple/i18n';
import {
  Body,
  CadenceBar,
  Card,
  Chevron,
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

import { cadenceStatuses, useCadences, usePlans } from '../../src/queries';
import { usePairedSession } from '../../src/session';

export default function Rhythm() {
  const { t, i18n } = useTranslation(['app', 'common', 'cadence']);
  const { couple } = usePairedSession();
  const router = useRouter();

  // One clock for the whole render, so no two countdowns disagree mid-paint.
  const now = useMemo(() => new Date(), []);
  const locale = i18n.language === 'es' ? 'es' : 'en';
  const timeZone = couple.timezone;

  const plansQuery = usePlans(couple.id);
  const cadencesQuery = useCadences(couple.id);

  const statuses = useMemo(
    () =>
      cadenceStatuses(
        cadencesQuery.data ?? [],
        plansQuery.data ?? [],
        couple.createdAt,
        timeZone,
        now,
      ),
    [cadencesQuery.data, plansQuery.data, couple.createdAt, timeZone, now],
  );

  if (plansQuery.isLoading || cadencesQuery.isLoading) return <Loading />;

  return (
    <Screen tabbed>
      <View className="gap-1">
        <Title>{t('app:home.title')}</Title>
        <Muted>{t('app:home.subtitle')}</Muted>
      </View>

      {/*
        Four lines of prose under each bar became one.
        `interval` restated the description's own tail — "Every 2 weeks" under
        "An evening out, every couple of weeks" — and `upcoming` listed three
        dates nobody has agreed to, on a screen whose entire job is to say
        whether one is overdue. What is left is the name, what it means, how
        long it has been, and the one date that was actually booked.
      */}
      {statuses.map((status) => {
        const due = dueTranslation(status.daysUntilDue);
        const label = t(kindLabelKey(status.domain as AppDomain, status.kind));

        return (
          <Card key={`${status.domain}.${status.kind}`}>
            {/* The whole card books this commitment — the only thing that ever
                resets its clock — so the button below it is gone. */}
            <Pressable
              accessibilityRole="button"
              /*
                The card is one accessible element now, so the bar's own
                `progressbar` label is no longer reachable and the countdown has
                to be spoken here. Name first: three cards announcing "Plan it"
                are three identical rows.
              */
              accessibilityLabel={`${label} — ${t(due.key, { count: due.count })}`}
              accessibilityHint={t('app:home.planIt')}
              className="gap-3"
              onPress={() => router.push({ pathname: '/plan/new', params: { kind: status.kind } })}
            >
              {/* Same reasoning as the other app: the card became the button
                  when its "Plan it" went, and without this it reads as a status
                  card you cannot do anything with. */}
              <View className="flex-row items-start justify-between gap-3">
                <View className="shrink gap-1">
                  <Heading>{label}</Heading>
                  <Muted>{t(kindDescriptionKey(status.domain as AppDomain, status.kind))}</Muted>
                </View>
                <View className="pt-2">
                  <Chevron />
                </View>
              </View>

              <CadenceBar
                progress={status.progress}
                health={status.health}
                label={t(due.key, { count: due.count })}
                healthLabel={t(healthLabelKey(status.health))}
              />

              {status.nextScheduledAt ? (
                <Body>
                  {t('app:home.bookedFor', {
                    date: formatDay(status.nextScheduledAt, locale, timeZone),
                  })}
                </Body>
              ) : (
                <Muted>
                  {status.lastCompletedAt
                    ? t('app:home.lastTime', {
                        date: formatDay(status.lastCompletedAt, locale, timeZone),
                      })
                    : t('app:home.neverYet')}
                </Muted>
              )}
            </Pressable>
          </Card>
        );
      })}
    </Screen>
  );
}
