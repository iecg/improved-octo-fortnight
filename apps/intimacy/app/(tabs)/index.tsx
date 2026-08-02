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
import { CHECKIN_INTERESTS, type CheckinInterest } from '@couple/core';
import { dueTranslation, formatWeekday, formatTime, kindLabelKeyFor } from '../../src/format';
import {
  Body,
  Button,
  CadenceBar,
  Card,
  Chip,
  Heading,
  Loading,
  Muted,
  Screen,
  Title,
} from '@couple/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import {
  cadenceStatuses,
  useCadences,
  useCheckins,
  usePlans,
  useRealtimeSync,
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

  useRealtimeSync(couple.id);

  const plansQuery = usePlans(couple.id);
  const cadencesQuery = useCadences(couple.id);
  const checkinsQuery = useCheckins(couple.id, timeZone, now);
  const recordCheckin = useRecordCheckin(couple.id, profile.id, timeZone);

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
    <Screen>
      <Title>{t('app:today.greeting')}</Title>

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

          {/* Sent with the answer rather than on its own: the chips are the
              only commit point on this screen, and a note without an answer
              is not a check-in. Blank stays blank — never an empty string. */}
          <TextInput
            className="min-h-16 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
            value={note}
            onChangeText={setEdited}
            onBlur={() => {
              // Only worth a write if there is already an answer to attach it
              // to; otherwise it waits for the chip.
              if (myCheckin)
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

          {theirCheckin ? (
            <Muted>
              {t('app:today.partnerAnswer', { name: partnerName })}
              {': '}
              {t(`app:checkin.${theirCheckin.interest}`)}
            </Muted>
          ) : (
            <Muted>{t('app:today.partnerNoAnswer', { name: partnerName })}</Muted>
          )}

          {/* Partner-written text is shown exactly as typed, in whatever
              language it was written. Never machine-translated. */}
          {theirCheckin?.note ? <Body>{theirCheckin.note}</Body> : null}

          <Muted>{t('app:checkin.noPressure')}</Muted>
        </View>
      </Card>

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

      <Card>
        <View className="gap-4">
          <Heading>{t('app:today.rituals')}</Heading>
          {statuses.map((status) => {
            const due = dueTranslation(status.daysUntilDue);
            return (
              <View key={`${status.domain}.${status.kind}`} className="gap-2">
                <Body>{t(kindLabelKeyFor(status.domain, status.kind))}</Body>
                <CadenceBar
                  progress={status.progress}
                  health={status.health}
                  label={t(due.key, { count: due.count })}
                />
                {/* The only thing that ever resets this particular clock: a
                    plan of this kind. Without it the bar is a countdown with
                    no way to answer it. */}
                <Button
                  label={t('app:today.planIt')}
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: '/plan/new', params: { kind: status.kind } })
                  }
                />
              </View>
            );
          })}
        </View>
      </Card>
    </Screen>
  );
}
