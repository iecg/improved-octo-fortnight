/**
 * Suggest a time.
 *
 * Free/busy is read from the phone's own calendar and never leaves it — the
 * blocks go straight into `suggestWindows`, a pure function, and only the
 * window the couple actually picks is sent to the server. That is the whole
 * privacy story of this screen, and it is why the search lives on-device
 * rather than behind a calendar OAuth integration.
 */
import { suggestWindows, type TimeRange } from '@couple/cadence';
import { INTIMACY_KINDS } from '@couple/core';
import { hasCalendarAccess, readBusyBlocks, requestCalendarAccess } from '@couple/device';
import { Body, Button, Card, Chip, Heading, Muted, Screen, Title } from '@couple/ui';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { formatWindowParts } from '../../src/format';
import { useProposeTime } from '../../src/queries';
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

  const propose = useProposeTime(couple.id, profile.id);

  const loadBusy = useCallback(async () => {
    const to = new Date(now.getTime() + SEARCH_DAYS * 24 * 60 * 60 * 1000);
    setBusyBlocks(await readBusyBlocks(now, to));
  }, [now]);

  useEffect(() => {
    void (async () => {
      const granted = await hasCalendarAccess();
      setCalendarOk(granted);
      if (granted) await loadBusy();
    })();
  }, [loadBusy]);

  const suggestions = useMemo(() => {
    if (busyBlocks === null) return [];
    return suggestWindows(busyBlocks, {
      from: now,
      to: new Date(now.getTime() + SEARCH_DAYS * 24 * 60 * 60 * 1000),
      durationMinutes: duration,
      earliestHour: EARLIEST_HOUR,
      latestHour: LATEST_HOUR,
      timeZone,
      limit: 5,
    });
  }, [busyBlocks, duration, now, timeZone]);

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
    await propose.mutateAsync({
      kind: INTIMACY_KINDS.intimacy.kind,
      startsAt: chosen.start,
      endsAt: chosen.end,
      notes: notes.trim() || null,
    });
    router.back();
  }

  return (
    <Screen>
      <Title>{t('app:propose.title')}</Title>

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

          {calendarOk === false ? (
            <>
              <Muted>{t('app:propose.needCalendar')}</Muted>
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

          {calendarOk && suggestions.length === 0 ? (
            <Muted>{t('app:propose.noSuggestions')}</Muted>
          ) : null}

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

      <View className="gap-2">
        <Button
          label={t('app:propose.send')}
          disabled={!chosen}
          loading={propose.isPending}
          onPress={() => void send()}
        />
        <Button label={t('common:action.cancel')} variant="ghost" onPress={() => router.back()} />
        {chosen ? <Body>{windowLabel(chosen)}</Body> : null}
      </View>
    </Screen>
  );
}
