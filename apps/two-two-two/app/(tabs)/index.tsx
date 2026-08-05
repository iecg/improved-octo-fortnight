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
import { healthLabelKey, nextOccurrences } from '@couple/cadence';
import { kindDescriptionKey, kindLabelKey, type AppDomain } from '@couple/core';
import { dueTranslation, formatDay, intervalTranslation } from '@couple/i18n';
import { Body, Button, CadenceBar, Card, Heading, Loading, Muted, Screen, Title } from '@couple/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

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

  const intervalFor = useMemo(() => {
    const byKind = new Map((cadencesQuery.data ?? []).map((c) => [c.kind, c]));
    return (kind: string) => byKind.get(kind);
  }, [cadencesQuery.data]);

  if (plansQuery.isLoading || cadencesQuery.isLoading) return <Loading />;

  return (
    <Screen>
      <View className="gap-1">
        <Title>{t('app:home.title')}</Title>
        <Muted>{t('app:home.subtitle')}</Muted>
      </View>

      {statuses.map((status) => {
        const due = dueTranslation(status.daysUntilDue);
        const cadence = intervalFor(status.kind);
        const interval = cadence
          ? intervalTranslation(cadence.intervalValue, cadence.intervalUnit)
          : null;
        // The rhythm ahead — the same derivation the intimacy app shows, from
        // the anchor the bar already uses. Past dates drop off.
        const upcoming = cadence
          ? nextOccurrences(cadence, status.anchorAt, 12, timeZone)
              .filter((date) => date > now)
              .slice(0, 3)
          : [];

        return (
          <Card key={`${status.domain}.${status.kind}`}>
            <View className="gap-3">
              <View className="gap-1">
                <Heading>{t(kindLabelKey(status.domain as AppDomain, status.kind))}</Heading>
                <Muted>{t(kindDescriptionKey(status.domain as AppDomain, status.kind))}</Muted>
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
              ) : null}

              <Muted>
                {status.lastCompletedAt
                  ? t('app:home.lastTime', {
                      date: formatDay(status.lastCompletedAt, locale, timeZone),
                    })
                  : t('app:home.neverYet')}
              </Muted>

              {interval ? <Muted>{t(interval.key, { count: interval.count })}</Muted> : null}

              {upcoming.length > 0 ? (
                <Muted>
                  {t('app:home.upcoming', {
                    dates: upcoming.map((date) => formatDay(date, locale, timeZone)).join(' · '),
                  })}
                </Muted>
              ) : null}

              {/* The only thing that ever resets this clock. */}
              <Button
                label={t('app:home.planIt')}
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/plan/new', params: { kind: status.kind } })
                }
              />
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
