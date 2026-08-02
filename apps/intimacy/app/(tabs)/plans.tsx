/**
 * Plans: what needs an answer, what is booked, and what already happened.
 *
 * Proposals awaiting *you* come first — they are the only thing on this screen
 * that is blocked on someone.
 */
import type { Plan, PlanProposal } from '@couple/core';
import { Body, Button, Card, Divider, Heading, Loading, Muted, Screen, Title } from '@couple/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatWindowParts } from '../../src/format';
import {
  useCompletePlan,
  usePendingProposals,
  usePlans,
  useRealtimeSync,
  useRespondToProposal,
} from '../../src/queries';
import { usePairedSession } from '../../src/session';

export default function Plans() {
  const { t, i18n } = useTranslation(['app', 'common', 'plans']);
  const { profile, couple, partner } = usePairedSession();
  const router = useRouter();

  const now = useMemo(() => new Date(), []);
  const locale = i18n.language === 'es' ? 'es' : 'en';
  const timeZone = couple.timezone;

  useRealtimeSync(couple.id);

  const plansQuery = usePlans(couple.id);
  const proposalsQuery = usePendingProposals(couple.id);
  const respond = useRespondToProposal(couple.id);
  const complete = useCompletePlan(couple.id);

  const partnerName = partner?.displayName ?? t('common:partner.unnamed');

  const { awaitingYou, awaitingThem } = useMemo(() => {
    const pending = proposalsQuery.data ?? [];
    return {
      awaitingYou: pending.filter((p) => p.proposedBy !== profile.id),
      awaitingThem: pending.filter((p) => p.proposedBy === profile.id),
    };
  }, [proposalsQuery.data, profile.id]);

  const { upcoming, history } = useMemo(() => {
    const all = plansQuery.data ?? [];
    return {
      upcoming: all
        .filter((p) => p.status === 'scheduled' && p.startsAt && new Date(p.startsAt) >= now)
        .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
      history: all.filter((p) => p.status === 'completed' || p.status === 'skipped').slice(0, 20),
    };
  }, [plansQuery.data, now]);

  function windowLabel(startsAt: string, endsAt: string | null): string {
    const parts = formatWindowParts(
      new Date(startsAt),
      new Date(endsAt ?? startsAt),
      locale,
      timeZone,
    );
    return t('plans:proposal.window', { start: parts.start, end: parts.end });
  }

  function ProposalCard({ proposal, mine }: { proposal: PlanProposal; mine: boolean }) {
    return (
      <Card>
        <View className="gap-3">
          <Muted>
            {mine
              ? t('plans:list.awaitingThem', { name: partnerName })
              : t('plans:proposal.from', { name: partnerName })}
          </Muted>
          <Body>{windowLabel(proposal.startsAt, proposal.endsAt)}</Body>

          {/* Shows the thread when this one replies to an earlier suggestion. */}
          {proposal.counteredFrom ? <Muted>{t('plans:proposal.counteredNote')}</Muted> : null}

          {mine ? null : (
            <View className="gap-2">
              <Button
                label={t('plans:proposal.accept')}
                onPress={() => respond.mutate({ proposal, response: 'accepted' })}
              />
              <Button
                label={t('plans:proposal.decline')}
                variant="secondary"
                onPress={() => respond.mutate({ proposal, response: 'declined' })}
              />
              {/* A third answer that is neither yes nor no: same plan, a
                  different time. Styled level with the other two, because
                  "not then, but yes" should be no harder to say. */}
              <Button
                label={t('plans:proposal.counter')}
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/plan/new',
                    params: { counterOf: proposal.id, planId: proposal.planId },
                  })
                }
              />
              {/* Declining is a complete answer, and the UI should say so
                  rather than nudge toward yes. */}
              <Muted>{t('plans:proposal.noPressure')}</Muted>
            </View>
          )}
        </View>
      </Card>
    );
  }

  function PlanRow({ plan, actionable }: { plan: Plan; actionable: boolean }) {
    return (
      <View className="gap-2 py-2">
        <Body>
          {plan.startsAt ? windowLabel(plan.startsAt, plan.endsAt) : t('common:state.empty')}
        </Body>
        {/* Shown exactly as written, in whatever language it was written. */}
        {plan.notes ? <Muted>{plan.notes}</Muted> : null}
        {actionable ? (
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
        ) : (
          <Muted>{t(`plans:status.${plan.status}`)}</Muted>
        )}
      </View>
    );
  }

  if (plansQuery.isLoading || proposalsQuery.isLoading) return <Loading />;

  return (
    <Screen>
      <Title>{t('app:tabs.plans')}</Title>

      {awaitingYou.length > 0 ? (
        <View className="gap-3">
          <Heading>{t('plans:list.awaitingYou')}</Heading>
          {awaitingYou.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} mine={false} />
          ))}
        </View>
      ) : null}

      {awaitingThem.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} mine />
      ))}

      <Card>
        <View className="gap-2">
          <Heading>{t('plans:list.upcoming')}</Heading>
          {upcoming.length === 0 ? <Muted>{t('plans:list.emptyUpcoming')}</Muted> : null}
          {upcoming.map((plan, index) => (
            <View key={plan.id}>
              {index > 0 ? <Divider /> : null}
              <PlanRow plan={plan} actionable />
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <View className="gap-2">
          <Heading>{t('plans:list.history')}</Heading>
          {history.length === 0 ? <Muted>{t('plans:list.emptyHistory')}</Muted> : null}
          {history.map((plan, index) => (
            <View key={plan.id}>
              {index > 0 ? <Divider /> : null}
              <PlanRow plan={plan} actionable={false} />
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
