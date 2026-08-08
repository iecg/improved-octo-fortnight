/**
 * Today.
 *
 * Three things, in the order they matter: how each of you is feeling, what is
 * already booked, and how the standing rhythm is going.
 *
 * The check-in is deliberately not a streak and not a score. "Not tonight" is
 * styled exactly like "yes" — an app that turns a no into a broken chain makes
 * the problem it is meant to solve worse.
 */
import { cadenceStatuses, healthLabelKey, plannerTurn } from '@couple/cadence';
import { CHECKIN_INTERESTS, kindLabelKey, type CheckinInterest } from '@couple/core';
import { dueTranslation, formatDay, formatTime, formatWeekday } from '@couple/i18n';
import {
  Body,
  Button,
  CadenceBar,
  Card,
  Chevron,
  Chip,
  Disclosure,
  Heading,
  Loading,
  Muted,
  Screen,
  Title,
} from '@couple/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import {
  useCadences,
  useCheckinLog,
  useCheckins,
  useClearCheckin,
  usePlans,
  useRecordCheckin,
} from '../../src/queries';
import { usePairedSession } from '../../src/session';

export default function Today() {
  const { t, i18n } = useTranslation(['app', 'common', 'cadence']);
  const { profile, couple, partner } = usePairedSession();
  const router = useRouter();

  // One clock for the whole render, so the countdown and the check-in date
  // cannot disagree with each other mid-paint.
  const now = useMemo(() => new Date(), []);
  const locale = i18n.language === 'es' ? 'es' : 'en';
  const timeZone = couple.timezone;

  const plansQuery = usePlans(couple.id);
  const cadencesQuery = useCadences(couple.id);
  const checkinsQuery = useCheckins(couple.id, timeZone, now);
  const checkinLog = useCheckinLog(couple.id, timeZone, now);
  const recordCheckin = useRecordCheckin(couple.id, profile.id, timeZone);
  const clearCheckin = useClearCheckin(couple.id, profile.id, timeZone);

  const partnerName = partner?.displayName ?? t('common:partner.unnamed');

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

  const nextBooked = useMemo(
    () =>
      (plansQuery.data ?? [])
        .filter((plan) => plan.status === 'scheduled' && plan.startsAt)
        .map((plan) => ({ plan, start: new Date(plan.startsAt as string) }))
        .filter((entry) => entry.start >= now)
        .sort((a, b) => a.start.getTime() - b.start.getTime())[0],
    [plansQuery.data, now],
  );

  const myCheckin = checkinsQuery.data?.find((entry) => entry.profileId === profile.id);
  const theirCheckin = checkinsQuery.data?.find((entry) => entry.profileId !== profile.id);

  /**
   * The note, which used to be readable and not writable: the partner's was
   * rendered below, and nothing in the app could produce one.
   *
   * `null` means "not edited on this device yet", so the stored note shows
   * through until someone types — no effect, and no chance of a refetch
   * landing on half-typed text.
   */
  const [edited, setEdited] = useState<string | null>(null);
  const note = edited ?? myCheckin?.note ?? '';

  if (plansQuery.isLoading || cadencesQuery.isLoading) return <Loading />;

  return (
    <Screen tabbed>
      <Title>{t('app:today.greeting')}</Title>

      {/*
        The one question this screen exists to ask, and nothing between it and
        the answer. The note used to sit directly under the chips — a text field
        pushing the partner's answer, which is why most people open this app, off
        past it. It is optional, so it is closed.
      */}
      <Card>
        <View className="gap-3">
          <Heading>{t('app:today.checkinPrompt')}</Heading>
          <View className="flex-row gap-2">
            {CHECKIN_INTERESTS.map((interest: CheckinInterest) => (
              <Chip
                key={interest}
                label={t(`app:checkin.${interest}`)}
                selected={myCheckin?.interest === interest}
                onPress={() => recordCheckin.mutate({ interest, note: note.trim() || null, now })}
              />
            ))}
          </View>

          {/* Directly under the chips, where it does its work: this is read
              while deciding, not afterwards. */}
          <Muted>{t('app:checkin.noPressure')}</Muted>

          {theirCheckin?.interest ? (
            <Muted>
              {t('app:today.partnerAnswer', { name: partnerName })}
              {': '}
              {t(`app:checkin.${theirCheckin.interest}`)}
            </Muted>
          ) : theirCheckin ? (
            /* A check-in exists but this device cannot open it. Say so plainly
               rather than render a missing translation key — and never guess at
               an answer, which is the one thing this screen must not do. */
            <Muted>{t('app:today.partnerUnreadable', { name: partnerName })}</Muted>
          ) : (
            <Muted>{t('app:today.partnerNoAnswer', { name: partnerName })}</Muted>
          )}

          {/* Partner-written text is shown exactly as typed, in whatever
              language it was written. Never machine-translated. */}
          {theirCheckin?.note ? <Body>{theirCheckin.note}</Body> : null}

          {/* Undo, back to no answer at all — re-tapping a chip only ever
              overwrites. Ghost-styled so it never competes with answering. */}
          {myCheckin ? (
            <Button
              label={t('app:checkin.clear')}
              variant="ghost"
              onPress={() => clearCheckin.mutate({ now })}
            />
          ) : null}
        </View>
      </Card>

      {/* Sent with the answer rather than on its own: the chips are the only
          commit point on this screen, and a note without an answer is not a
          check-in. Blank stays blank — never an empty string. */}
      <Disclosure label={t('app:checkin.noteLabel')}>
        <Card>
          <TextInput
            className="min-h-16 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
            value={note}
            onChangeText={setEdited}
            onBlur={() => {
              // Only worth a write if there is already an answer to attach it
              // to; otherwise it waits for the chip. `interest` is null when
              // the payload would not open, and re-sending a guess there would
              // put an answer in someone's mouth.
              if (myCheckin?.interest)
                recordCheckin.mutate({
                  interest: myCheckin.interest,
                  note: note.trim() || null,
                  now,
                });
            }}
            placeholder={t('app:checkin.notePlaceholder')}
            accessibilityLabel={t('app:checkin.noteLabel')}
            multiline
          />
        </Card>
      </Disclosure>

      <Card>
        <View className="gap-2">
          <Heading>{t('app:today.nextUp')}</Heading>
          {nextBooked ? (
            <>
              <Body>{formatWeekday(nextBooked.start, locale, timeZone)}</Body>
              <Muted>{formatTime(nextBooked.start, locale, timeZone)}</Muted>
              {nextBooked.plan.notes ? <Body>{nextBooked.plan.notes}</Body> : null}
            </>
          ) : (
            <Muted>{t('app:today.nothingBooked')}</Muted>
          )}
          <Button label={t('app:today.propose')} onPress={() => router.push('/plan/new')} />
        </View>
      </Card>

      {/*
        Each ritual is one row and the whole row is the button, which is the
        only thing that ever resets that particular clock. It used to be a
        `Button` per ritual *plus* the one above, so a screen whose job is to
        ask one question offered four ways to leave it.

        Each row also carried three projected dates under the bar. They were not
        bookings and nobody had agreed to them — `nextOccurrences` simply
        extrapolates the interval — so they read as commitments that did not
        exist. The bar already says how long it has been.
      */}
      <Card>
        <View className="gap-4">
          <Heading>{t('cadence:list.title')}</Heading>
          {statuses.map((status) => {
            const due = dueTranslation(status.daysUntilDue);
            const label = t(kindLabelKey(status.domain, status.kind));

            /*
              Whose turn it is to suggest — *suggest*, not book, because that is
              what this app does: one of them proposes a time and the other
              answers. The 2-2-2 app books outright, so it says book.

              The softer verb is not only accuracy. This screen's whole posture
              is that there is no wrong answer and no streak to keep, and one of
              these three rituals is the most personal thing in either app.
              "Your turn" has to read as whose move it is, never as something
              owed.
            */
            const turn = plannerTurn(status, profile.id);
            const turnLabel =
              turn === 'you'
                ? t('app:today.turnYours')
                : turn === 'them'
                  ? t('app:today.turnTheirs', { name: partnerName })
                  : null;
            const showTurn = !status.nextScheduledAt && turnLabel !== null;

            return (
              <Pressable
                key={`${status.domain}.${status.kind}`}
                accessibilityRole="button"
                /*
                  `Pressable` is accessible by default, so the row is one
                  element and the bar's own `progressbar` label no longer
                  reaches a screen reader. The countdown therefore has to be in
                  here, the same way `CadenceBar` composes its own label — and
                  the ritual's name has to come first, or all three rows
                  announce identically and the list is unusable. The turn joins
                  it for the same reason: rendered as a child it would be
                  swallowed and never spoken.
                */
                accessibilityLabel={[label, t(due.key, { count: due.count })]
                  .concat(showTurn ? [turnLabel] : [])
                  .join(' — ')}
                accessibilityHint={t('app:today.planIt')}
                className="min-h-12 gap-2"
                onPress={() =>
                  router.push({ pathname: '/plan/new', params: { kind: status.kind } })
                }
              >
                {/* The chevron is the whole reason this reads as a control.
                    Dropping the per-ritual button made the row the button, and
                    a row of text over a progress bar looks exactly like a
                    status readout — which is what it used to be. */}
                <View className="flex-row items-center justify-between gap-3">
                  <Body>{label}</Body>
                  <Chevron />
                </View>
                <CadenceBar
                  progress={status.progress}
                  health={status.health}
                  label={t(due.key, { count: due.count })}
                  healthLabel={t(healthLabelKey(status.health))}
                />
                {/* Nothing at all when there is no turn to name, and nothing
                    once a time is already proposed — the rotation answers who
                    goes next, and a proposal has answered it. */}
                {showTurn ? <Muted>{turnLabel}</Muted> : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* A plain record of recent answers, newest first — no count and no
          streak, the same neutrality as the chips above. Closed, because it is
          a thing you look up rather than a thing you are told. */}
      {(checkinLog.data ?? []).length > 0 ? (
        <Disclosure label={t('app:checkin.logTitle')}>
          <Card>
            <View className="gap-2">
              {(checkinLog.data ?? []).map((entry) => (
                <View key={entry.id} className="gap-1 py-1">
                  <Muted>{formatDay(new Date(`${entry.onDate}T12:00:00Z`), locale, 'UTC')}</Muted>
                  <Body>
                    {entry.profileId === profile.id
                      ? t('app:checkin.logMine', { answer: t(`app:checkin.${entry.interest}`) })
                      : t('app:checkin.logTheirs', {
                          name: partnerName,
                          answer: t(`app:checkin.${entry.interest}`),
                        })}
                  </Body>
                </View>
              ))}
            </View>
          </Card>
        </Disclosure>
      ) : null}
    </Screen>
  );
}
