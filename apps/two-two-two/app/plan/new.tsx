/**
 * Book one of the three.
 *
 * Without this screen the app can only ever count upwards — the clocks on the
 * rhythm tab have nothing to reset them. Everything is written straight to
 * `scheduled`, because there is no negotiation step here: a getaway either has
 * a date or it does not.
 *
 * Days and times are chosen from chips rather than a native picker. That is
 * not a shortcut for its own sake — the whole screen then needs no native
 * module, works in Expo Go, and matches how the other app already asks the
 * same question. All of the date arithmetic goes through `@couple/cadence`
 * against the couple's timezone; none of it happens here.
 */
import { addInterval, atHourInZone } from '@couple/cadence';
import { TWO_TWO_TWO_KINDS, kindLabelKey, type AppDomain } from '@couple/core';
import { formatDay, formatTime } from '@couple/i18n';
import { Body, Button, Card, Chip, Heading, Muted, Screen, Title } from '@couple/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { normalizeManualPlace } from '../../src/features/places/label';
import type { PlaceResult } from '../../src/features/places/maps/types';
import { PlaceSearch } from '../../src/features/places/PlaceSearch';
import { useCreatePlan } from '../../src/queries';
import { usePairedSession } from '../../src/session';

/** How far ahead the day chips run. A trip booked further out can be edited later. */
const DAY_CHOICES = 14;

/** Wall-clock start times offered, in the couple's timezone. */
const HOUR_CHOICES = [9, 12, 18, 20];

/**
 * How long each kind tends to last. An evening is measured in hours; a getaway
 * or a trip is measured in nights, which is also how anyone books one.
 */
const DURATIONS: Record<string, { unit: 'hour' | 'night'; values: number[]; defaultHour: number }> =
  {
    date_night: { unit: 'hour', values: [2, 3, 4], defaultHour: 18 },
    getaway: { unit: 'night', values: [1, 2, 3], defaultHour: 9 },
    trip: { unit: 'night', values: [3, 7, 14], defaultHour: 9 },
  };

export default function NewPlan() {
  const { t, i18n } = useTranslation(['app', 'common', 'cadence', 'plans', 'places']);
  const { profile, couple } = usePairedSession();
  const router = useRouter();

  const locale = i18n.language === 'es' ? 'es' : 'en';
  const timeZone = couple.timezone;
  const now = useMemo(() => new Date(), []);

  // Arriving from a card on the rhythm screen preselects that commitment. An
  // unrecognised param is ignored rather than trusted — it reaches a `kind`
  // column with a slug constraint on it.
  const params = useLocalSearchParams<{ kind?: string; title?: string }>();
  const [kind, setKind] = useState<string>(
    params.kind && params.kind in TWO_TWO_TWO_KINDS
      ? params.kind
      : TWO_TWO_TWO_KINDS.date_night.kind,
  );
  // Arriving from the ideas screen prefills the title, still editable.
  const [title, setTitle] = useState(params.title ?? '');
  // Typed by hand. Nothing on this screen asks whether a mapping provider
  // exists, which is what keeps the whole screen working without one — a
  // searched place only ever fills these in for you.
  const [place, setPlace] = useState('');
  const [found, setFound] = useState<PlaceResult | null>(null);
  const [shareAddress, setShareAddress] = useState(false);
  const [dayIndex, setDayIndex] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const create = useCreatePlan(couple.id, profile.id);
  const shape = DURATIONS[kind] ?? DURATIONS.date_night!;

  // Falling back to the kind's default rather than storing it on selection
  // keeps switching kinds from stranding a 14-night date night.
  const chosenHour = hour ?? shape.defaultHour;
  const chosenDuration = duration ?? shape.values[0]!;

  /** Calendar days from today, stepped in the couple's timezone so DST cannot skew them. */
  const days = useMemo(() => {
    const out: Date[] = [];
    let cursor = now;
    for (let i = 0; i < DAY_CHOICES; i += 1) {
      out.push(cursor);
      cursor = addInterval(cursor, 1, 'day', timeZone);
    }
    return out;
  }, [now, timeZone]);

  const startsAt = useMemo(
    () => atHourInZone(days[dayIndex] ?? now, chosenHour, timeZone),
    [days, dayIndex, now, chosenHour, timeZone],
  );

  const endsAt = useMemo(() => {
    if (shape.unit === 'hour') {
      return new Date(startsAt.getTime() + chosenDuration * 3_600_000);
    }
    // Nights land on the same wall-clock hour N days later, not 24h × N.
    return atHourInZone(
      addInterval(startsAt, chosenDuration, 'day', timeZone),
      chosenHour,
      timeZone,
    );
  }, [shape.unit, startsAt, chosenDuration, chosenHour, timeZone]);

  function durationLabel(value: number): string {
    return shape.unit === 'hour'
      ? t('app:plan.hours', { count: value })
      : t('app:plan.nights', { count: value });
  }

  async function save() {
    const name = normalizeManualPlace(place);
    // A searched result only counts while the field still holds its name — if
    // the text was edited afterwards, what is on screen is what gets saved.
    const searched = found && found.name === name ? found : null;

    await create.mutateAsync({
      kind,
      title: title.trim() || null,
      startsAt,
      endsAt,
      place: name
        ? {
            name,
            address: searched?.address ?? null,
            provider: searched ? 'google' : 'manual',
            providerPlaceId: searched?.providerPlaceId ?? null,
            coordinates: searched?.coordinates ?? null,
            // The language it was typed or returned in, so a partner reading in
            // the other one is told rather than shown a translation.
            locale,
            shareWithCalendar: shareAddress,
          }
        : null,
    });
    router.back();
  }

  return (
    <Screen>
      <Title>{t('app:plan.title')}</Title>

      <Card>
        <View className="gap-3">
          <Heading>{t('app:plan.kind')}</Heading>
          <View className="flex-row gap-2">
            {Object.values(TWO_TWO_TWO_KINDS).map((definition) => (
              <Chip
                key={definition.kind}
                label={t(kindLabelKey(definition.domain as AppDomain, definition.kind))}
                selected={kind === definition.kind}
                onPress={() => {
                  setKind(definition.kind);
                  // The old duration means something different under a new
                  // kind, so both fall back to that kind's defaults.
                  setDuration(null);
                  setHour(null);
                }}
              />
            ))}
          </View>
        </View>
      </Card>

      <Card>
        <View className="gap-2">
          <Heading>{t('app:plan.titleLabel')}</Heading>
          <TextInput
            className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
            value={title}
            onChangeText={setTitle}
            placeholder={t('app:plan.titlePlaceholder')}
            accessibilityLabel={t('app:plan.titleLabel')}
          />
          {/* Sets the expectation that this reaches the partner untranslated. */}
          <Muted>{t('app:plan.titleHint')}</Muted>
        </View>
      </Card>

      <Card>
        <View className="gap-2">
          <Heading>{t('places:label')}</Heading>
          <TextInput
            className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
            value={place}
            onChangeText={setPlace}
            placeholder={t('places:manual.placeholder')}
            accessibilityLabel={t('places:label')}
          />
          <Muted>{t('places:manual.hint')}</Muted>
          {/* Renders nothing at all when no mapping key is configured, which
              leaves the text field above as the whole feature. */}
          <PlaceSearch
            kind={kind}
            onPick={(result) => {
              setFound(result);
              setPlace(result.name);
            }}
          />
          {found?.address ? <Muted>{found.address}</Muted> : null}
          {/* Only worth asking once there is an address to share. */}
          {normalizeManualPlace(place) ? (
            <View className="gap-2">
              <Chip
                label={t('places:calendar.share')}
                selected={shareAddress}
                onPress={() => setShareAddress((on) => !on)}
              />
              <Muted>{t('places:calendar.shareHint')}</Muted>
            </View>
          ) : null}
        </View>
      </Card>

      <Card>
        <View className="gap-3">
          <Heading>{t('app:plan.when')}</Heading>
          <View className="flex-row flex-wrap gap-2">
            {days.map((day, index) => (
              <Chip
                key={day.toISOString()}
                label={formatDay(day, locale, timeZone)}
                selected={dayIndex === index}
                onPress={() => setDayIndex(index)}
              />
            ))}
          </View>
        </View>
      </Card>

      <Card>
        <View className="gap-3">
          <Heading>{t('app:plan.startTime')}</Heading>
          <View className="flex-row gap-2">
            {HOUR_CHOICES.map((value) => (
              <Chip
                key={value}
                label={formatTime(atHourInZone(startsAt, value, timeZone), locale, timeZone)}
                selected={chosenHour === value}
                onPress={() => setHour(value)}
              />
            ))}
          </View>
        </View>
      </Card>

      <Card>
        <View className="gap-3">
          <Heading>{t('app:plan.howLong')}</Heading>
          <View className="flex-row gap-2">
            {shape.values.map((value) => (
              <Chip
                key={value}
                label={durationLabel(value)}
                selected={chosenDuration === value}
                onPress={() => setDuration(value)}
              />
            ))}
          </View>
        </View>
      </Card>

      <View className="gap-2">
        <Body>{t('app:plan.summary', { date: formatDay(startsAt, locale, timeZone) })}</Body>
        <Button label={t('app:plan.save')} loading={create.isPending} onPress={() => void save()} />
        <Button label={t('common:action.cancel')} variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
