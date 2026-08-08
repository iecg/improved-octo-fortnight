/**
 * One plan, in full.
 *
 * Reached from a row on the plans screen and deep-linkable by id. The row lists
 * only a time and a note; this is where a plan's kind, place and status live
 * together. Read by id through the domain repository, so an id from the other
 * app's domain resolves to nothing rather than crossing the boundary.
 */
import { kindLabelKey } from '@couple/core';
import { formatWindowParts } from '@couple/i18n';
import { Body, Button, Card, Heading, Loading, Muted, Screen, Title } from '@couple/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useGetPlan } from '../../src/queries';
import { usePairedSession } from '../../src/session';

export default function PlanDetail() {
  const { t, i18n } = useTranslation(['plans', 'common']);
  const { couple } = usePairedSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const locale = i18n.language === 'es' ? 'es' : 'en';
  const timeZone = couple.timezone;

  const planQuery = useGetPlan(id);

  function windowLabel(startsAt: string, endsAt: string | null): string {
    const parts = formatWindowParts(
      new Date(startsAt),
      new Date(endsAt ?? startsAt),
      locale,
      timeZone,
    );
    return t('plans:proposal.window', { start: parts.start, end: parts.end });
  }

  if (planQuery.isLoading) return <Loading />;
  const plan = planQuery.data;

  return (
    <Screen
      /* Pinned, like every other primary action in these apps: a plan with a
         long note is a scrolling screen, and the way out of it should not be. */
      footer={
        <Button label={t('plans:detail.back')} variant="ghost" onPress={() => router.back()} />
      }
    >
      {plan ? (
        <>
          {/* The title is the couple's own words when they gave any, shown
              verbatim; otherwise the ritual's name. */}
          <Title>{plan.title ?? t(kindLabelKey(plan.domain, plan.kind))}</Title>
          <Muted>{t(`plans:status.${plan.status}`)}</Muted>

          <Card>
            <View className="gap-3">
              <View className="gap-1">
                <Heading>{t('plans:detail.when')}</Heading>
                <Body>
                  {plan.startsAt
                    ? windowLabel(plan.startsAt, plan.endsAt)
                    : t('common:state.empty')}
                </Body>
              </View>

              {plan.location ? (
                <View className="gap-1">
                  <Heading>{t('plans:detail.where')}</Heading>
                  <Body>{plan.location}</Body>
                </View>
              ) : null}

              {plan.notes ? (
                <View className="gap-1">
                  <Heading>{t('plans:detail.notes')}</Heading>
                  {/* Verbatim, in whatever language it was written. */}
                  <Body>{plan.notes}</Body>
                </View>
              ) : null}
            </View>
          </Card>
        </>
      ) : (
        <Muted>{t('plans:detail.notFound')}</Muted>
      )}
    </Screen>
  );
}
