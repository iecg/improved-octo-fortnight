/**
 * Plans: what needs an answer, what is booked, and what already happened.
 *
 * Two things here are blocked on somebody, and they are the two that stay open.
 * A proposal awaiting *you* comes first. Under it, plans that were booked and
 * whose time has passed with nobody saying whether they happened — a group that
 * did not exist until `groupPlans`, because the old filters put those rows in
 * neither list and the couple could not reach them at all.
 *
 * Everything below is a record rather than a request, so it is closed:
 * `history` and the proposal log.
 */
import { formatWindowParts } from '@couple/i18n';
import { groupPlans } from '@couple/cadence';
import type { Plan, PlanProposal } from '@couple/core';
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

import {
  useCompletePlan,
  usePendingProposals,
  usePlans,
  useProposalHistory,
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

  const plansQuery = usePlans(couple.id);
  const proposalsQuery = usePendingProposals(couple.id);
  const proposalHistoryQuery = useProposalHistory(couple.id);
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

  // The same pure grouping the 2-2-2 app uses. These two `useMemo` blocks were
  // identical, which is how one bug lived in both.
  const { needsAnswer, upcoming, history } = useMemo(
    () => groupPlans(plansQuery.data ?? [], now),
    [plansQuery.data, now],
  );

  // The resolved proposals only — the pending ones already drive the top of
  // the screen. Newest first, exactly as `listProposals` returns them.
  const pastProposals = useMemo(
    () => (proposalHistoryQuery.data ?? []).filter((p) => p.response !== 'pending'),
    [proposalHistoryQuery.data],
  );

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
        {/* The row's time opens the full plan; the action buttons below stay
            their own targets. */}
        <Pressable onPress={() => router.push(`/plan/${plan.id}`)}>
          <Body>
            {plan.startsAt ? windowLabel(plan.startsAt, plan.endsAt) : t('common:state.empty')}
          </Body>
        </Pressable>
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
    <Screen tabbed>
      <Title>{t('common:tabs.plans')}</Title>

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

      {/*
        Booked, over, and nobody has said whether it happened — invisible until
        now, because it matched neither the upcoming filter nor the history one.
        Above `upcoming` because it is the only group here that is waiting on
        somebody.
      */}
      {needsAnswer.length > 0 ? (
        <Card>
          <View className="gap-2">
            <Heading>{t('plans:list.needsAnswer')}</Heading>
            {needsAnswer.map((plan, index) => (
              <View key={plan.id}>
                {index > 0 ? <Divider /> : null}
                <PlanRow plan={plan} actionable />
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
            <View key={plan.id}>
              {index > 0 ? <Divider /> : null}
              <PlanRow plan={plan} actionable />
            </View>
          ))}
        </View>
      </Card>

      {/* Both of these are records rather than requests, so both are closed.
          Five open sections was the densest screen in this app after Settings. */}
      <Disclosure label={t('plans:list.history')}>
        <Card>
          <View className="gap-2">
            {history.length === 0 ? <Muted>{t('plans:list.emptyHistory')}</Muted> : null}
            {history.map((plan, index) => (
              <View key={plan.id}>
                {index > 0 ? <Divider /> : null}
                <PlanRow plan={plan} actionable={false} />
              </View>
            ))}
          </View>
        </Card>
      </Disclosure>

      {pastProposals.length > 0 ? (
        <Disclosure label={t('plans:proposalLog.title')}>
          <Card>
            <View className="gap-2">
              {/* The negotiation as it went — accepted, declined and countered
                  times, newest first. A record, not a tally. */}
              {pastProposals.map((proposal, index) => (
                <View key={proposal.id} className="gap-1 py-2">
                  {index > 0 ? <Divider /> : null}
                  <Body>{windowLabel(proposal.startsAt, proposal.endsAt)}</Body>
                  <Muted>{t(`plans:proposalLog.${proposal.response}`)}</Muted>
                  {proposal.counteredFrom ? (
                    <Muted>{t('plans:proposal.counteredNote')}</Muted>
                  ) : null}
                </View>
              ))}
            </View>
          </Card>
        </Disclosure>
      ) : null}
    </Screen>
  );
}
