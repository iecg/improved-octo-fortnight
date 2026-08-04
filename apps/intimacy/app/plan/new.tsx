/**
 * Suggest a time.
 *
 * Free/busy comes from three places, and none of them sends the couple's
 * calendar anywhere. The phone's own calendar is read on-device and stays
 * there. This app's plans are already loaded. The third is the server's busy
 * view, which returns start and end times for both apps and carries no title,
 * no notes and no domain — it cannot say what fills a window, only that one is
 * filled. All three go into `suggestWindows`, a pure function, and only the
 * window the couple actually picks is written back.
 *
 * The server source is what makes this screen work at all for someone who
 * refused calendar access — it used to offer nothing whatsoever — and it is
 * the only thing that knows about a `proposed` time, which by design reaches
 * no calendar. It is read unconditionally here: what it discloses in this
 * direction is that a date night is booked, and this is the app behind the
 * lock. The 2-2-2 app asks first.
 */
import { busyFromPlans, mergeRanges, suggestWindows, type TimeRange } from '@couple/cadence';
import { INTIMACY_KINDS, findKind, kindLabelKey, kindsForDomain } from '@couple/core';
import { hasCalendarAccess, readBusyBlocks, requestCalendarAccess } from '@couple/device';
import { Body, Button, Card, Chip, Heading, Muted, Screen, Title } from '@couple/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { formatWindowParts } from '../../src/format';
import { useCounterProposal, usePlans, useProposeTime, useServerBusy } from '../../src/queries';
import { usePairedSession } from '../../src/session';

/** Evening hours in the couple's timezone. */
const EARLIEST_HOUR = 20;
const LATEST_HOUR = 23;
const DURATION_CHOICES = [45, 90, 150];
const SEARCH_DAYS = 10;

export default function NewPlan() {
  const { t, i18n } = useTranslation(['app', 'common', 'plans']);
  const { profile, couple } = usePairedSession();
  const router = useRouter();

  const locale = i18n.language === 'es' ? 'es' : 'en';
  const timeZone = couple.timezone;
  const now = useMemo(() => new Date(), []);

  const [duration, setDuration] = useState(90);
  const [notes, setNotes] = useState('');
  const [busyBlocks, setBusyBlocks] = useState<TimeRange[] | null>(null);
  const [calendarOk, setCalendarOk] = useState<boolean | null>(null);
  const [chosen, setChosen] = useState<TimeRange | null>(null);

  /**
   * Arriving with both ids means this is a reply to a suggestion rather than a
   * fresh one. Both must be present to count — half a pair is a malformed
   * link, and answering the wrong proposal is worse than starting over.
   */
  const params = useLocalSearchParams<{ counterOf?: string; planId?: string; kind?: string }>();
  const counterOf =
    params.counterOf && params.planId
      ? { proposalId: params.counterOf, planId: params.planId }
      : null;

  /**
   * Which ritual this suggestion is for.
   *
   * Arriving from a bar on Today preselects that one. An unrecognised param is
   * ignored rather than trusted — it reaches a `kind` column with a slug
   * constraint on it — which is what `findKind` is for.
   *
   * This used to be hard-coded to `intimacy`, and the other two rituals were
   * therefore unreachable: Today drew a countdown for each, `computeCadenceStatus`
   * re-anchors only on plans matching `(domain, kind)`, and nothing could ever
   * produce one. Two clocks counted up forever.
   */
  const [kind, setKind] = useState<string>(
    (params.kind && findKind('intimacy', params.kind)?.kind) ?? INTIMACY_KINDS.intimacy.kind,
  );

  const propose = useProposeTime(couple.id, profile.id);
  const counter = useCounterProposal(couple.id, profile.id);
  const pending = counterOf ? counter.isPending : propose.isPending;

  const searchTo = useMemo(
    () => new Date(now.getTime() + SEARCH_DAYS * 24 * 60 * 60 * 1000),
    [now],
  );

  const loadBusy = useCallback(async () => {
    setBusyBlocks(await readBusyBlocks(now, searchTo));
  }, [now, searchTo]);

  useEffect(() => {
    void (async () => {
      const granted = await hasCalendarAccess();
      setCalendarOk(granted);
      if (granted) await loadBusy();
    })();
  }, [loadBusy]);

  const plansQuery = usePlans(couple.id);
  const serverBusy = useServerBusy(couple.id, now, searchTo);

  /**
   * Everything the screen knows about, coalesced once.
   *
   * `mergeRanges` sorts and joins, so a plan that is both in this app's list
   * and on the phone's calendar — which is every booked plan — collapses to one
   * block instead of being subtracted twice.
   */
  const busy = useMemo(
    () =>
      mergeRanges([
        ...busyFromPlans(plansQuery.data ?? []),
        ...(busyBlocks ?? []),
        ...(serverBusy.data ?? []),
      ]),
    [plansQuery.data, busyBlocks, serverBusy.data],
  );

  /**
   * Note there is no "we do not know yet" early return any more.
   *
   * There used to be: with no calendar permission this returned `[]` and the
   * screen offered nothing at all, which made a refused permission look like a
   * broken app. Two of the three sources need no permission, so a search
   * always runs. Granting calendar access sharpens the answer; it no longer
   * gates it.
   */
  const suggestions = useMemo(
    () =>
      suggestWindows(busy, {
        from: now,
        to: searchTo,
        durationMinutes: duration,
        earliestHour: EARLIEST_HOUR,
        latestHour: LATEST_HOUR,
        timeZone,
        limit: 5,
      }),
    [busy, duration, now, searchTo, timeZone],
  );

  function durationLabel(minutes: number): string {
    return minutes % 60 === 0
      ? t('app:propose.durationHours', { count: minutes / 60 })
      : t('app:propose.durationMinutes', { count: minutes });
  }

  function windowLabel(window: TimeRange): string {
    const parts = formatWindowParts(window.start, window.end, locale, timeZone);
    return t('plans:proposal.window', { start: parts.start, end: parts.end });
  }

  async function send() {
    if (!chosen) return;
    if (counterOf) {
      // The counter replaces the time, not the plan — notes stay with the
      // original suggestion rather than being silently rewritten.
      await counter.mutateAsync({
        proposalId: counterOf.proposalId,
        planId: counterOf.planId,
        startsAt: chosen.start,
        endsAt: chosen.end,
      });
    } else {
      await propose.mutateAsync({
        kind,
        startsAt: chosen.start,
        endsAt: chosen.end,
        notes: notes.trim() || null,
      });
    }
    router.back();
  }

  return (
    <Screen>
      <Title>{counterOf ? t('plans:proposal.counter') : t('app:propose.title')}</Title>
      {counterOf ? <Muted>{t('plans:proposal.counteredNote')}</Muted> : null}

      {/* A counter answers the time on a plan that already exists, so its kind
          is settled and not offered again. */}
      {counterOf ? null : (
        <Card>
          <View className="gap-3">
            <Heading>{t('app:propose.kind')}</Heading>
            <View className="flex-row flex-wrap gap-2">
              {kindsForDomain('intimacy').map((definition) => (
                <Chip
                  key={definition.kind}
                  label={t(kindLabelKey(definition.domain, definition.kind))}
                  selected={kind === definition.kind}
                  onPress={() => setKind(definition.kind)}
                />
              ))}
            </View>
          </View>
        </Card>
      )}

      <Card>
        <View className="gap-3">
          <Heading>{t('app:propose.duration')}</Heading>
          <View className="flex-row gap-2">
            {DURATION_CHOICES.map((minutes) => (
              <Chip
                key={minutes}
                label={durationLabel(minutes)}
                selected={duration === minutes}
                onPress={() => {
                  setDuration(minutes);
                  setChosen(null);
                }}
              />
            ))}
          </View>
        </View>
      </Card>

      <Card>
        <View className="gap-3">
          <Heading>{t('app:propose.suggestions')}</Heading>

          {/* An offer, not a gate. The suggestions below are rendered either
              way; calendar access only makes them better informed. */}
          {calendarOk === false ? (
            <>
              <Muted>{t('app:propose.sharperWithCalendar')}</Muted>
              <Button
                label={t('app:propose.grantCalendar')}
                variant="secondary"
                onPress={() =>
                  void requestCalendarAccess().then(async (granted) => {
                    setCalendarOk(granted);
                    if (granted) await loadBusy();
                  })
                }
              />
            </>
          ) : null}

          {suggestions.length === 0 ? <Muted>{t('app:propose.noSuggestions')}</Muted> : null}

          {suggestions.map((window) => (
            <Chip
              key={window.start.toISOString()}
              label={windowLabel(window)}
              selected={chosen?.start.getTime() === window.start.getTime()}
              onPress={() => setChosen(window)}
            />
          ))}
        </View>
      </Card>

      {/* A counter answers the time. The note the other person wrote stays
          theirs, so this is not offered again. */}
      {counterOf ? null : (
        <Card>
          <View className="gap-2">
            <Heading>{t('plans:new.notesLabel')}</Heading>
            <TextInput
              className="min-h-20 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
              value={notes}
              onChangeText={setNotes}
              placeholder={t('plans:new.notesPlaceholder')}
              multiline
              accessibilityLabel={t('plans:new.notesLabel')}
            />
            {/* Sets the expectation that this reaches the partner untranslated. */}
            <Muted>{t('plans:new.notesHint')}</Muted>
          </View>
        </Card>
      )}

      <View className="gap-2">
        <Button
          label={t('app:propose.send')}
          disabled={!chosen}
          loading={pending}
          onPress={() => void send()}
        />
        <Button label={t('common:action.cancel')} variant="ghost" onPress={() => router.back()} />
        {chosen ? <Body>{windowLabel(chosen)}</Body> : null}
      </View>
    </Screen>
  );
}
