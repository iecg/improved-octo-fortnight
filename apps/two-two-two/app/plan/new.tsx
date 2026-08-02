/**
 * Book one of the three.
 *
 * Without this screen the app can only ever count upwards — the clocks on the
 * rhythm tab have nothing to reset them. Everything is written straight to
 * `scheduled`, because there is no negotiation step here: a getaway either has
 * a date or it does not.
 *
 * Days and times are chosen from chips rather than a native picker, matching
 * how the other app already asks the same question. All of the date arithmetic
 * goes through `@couple/cadence` against the couple's timezone; none of it
 * happens here.
 *
 * Choices that clash with something already spoken for are marked, from three
 * sources that answer progressively more of the question:
 *
 *   * This app's own plans, straight out of the query the screen already runs.
 *     Free, and needs no permission from anyone.
 *   * The phone's calendar, if access was granted. Catches the couple's whole
 *     life, not just what these two apps know about.
 *   * The server's busy view, *if the reader has turned it on* — occupied
 *     windows across both apps, times and nothing else. Off by default, and
 *     the only source that can see the other app.
 *
 * Every one of them is a hint. Any can be absent and the screen still books a
 * plan; nothing here is gated on the other app existing, on a permission, or
 * on a setting. Marks are never a block either — deciding to overlap is the
 * couple's business.
 */
import {
  addInterval,
  atHourInZone,
  busyFromPlans,
  mergeRanges,
  overlapsAny,
  type TimeRange,
} from '@couple/cadence';
import { TWO_TWO_TWO_KINDS, kindLabelKey, type AppDomain } from '@couple/core';
import { hasCalendarAccess, readBusyBlocks } from '@couple/device';
import { formatDay, formatTime } from '@couple/i18n';
import { Body, Button, Card, Chip, Heading, Muted, Screen, Title } from '@couple/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { normalizeManualPlace } from '../../src/features/places/label';
import type { PlaceResult } from '../../src/features/places/maps/types';
import { PlaceSearch } from '../../src/features/places/PlaceSearch';
import { useCreatePlan, usePlans, useServerBusy } from '../../src/queries';
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

  /**
   * The span a plan would occupy if it started on `day` at `hourValue`.
   *
   * Shared by the chosen range and by the conflict marks, so a chip can never
   * disagree with what saving would actually book.
   */
  const rangeFor = useCallback(
    (day: Date, hourValue: number): TimeRange => {
      const start = atHourInZone(day, hourValue, timeZone);
      const end =
        shape.unit === 'hour'
          ? new Date(start.getTime() + chosenDuration * 3_600_000)
          : // Nights land on the same wall-clock hour N days later, not 24h × N.
            atHourInZone(addInterval(start, chosenDuration, 'day', timeZone), hourValue, timeZone);
      return { start, end };
    },
    [shape.unit, chosenDuration, timeZone],
  );

  const { start: startsAt, end: endsAt } = useMemo(
    () => rangeFor(days[dayIndex] ?? now, chosenHour),
    [rangeFor, days, dayIndex, now, chosenHour],
  );

  /**
   * What a conflict is judged against — the *first day* of a multi-night span,
   * not the whole thing.
   *
   * A 14-night trip overlaps everything in the next fortnight, so checking the
   * full span marks every chip and the mark stops meaning anything. It is also
   * not the question being asked: moving the departure day moves the whole
   * window, so a clash on night six travels with it. The clash you can act on
   * by picking a different chip is the one on the day you leave.
   *
   * Date nights are hours, not nights, so their full span is the first day and
   * this changes nothing for them.
   */
  const conflictRangeFor = useCallback(
    (day: Date, hourValue: number): TimeRange => {
      const span = rangeFor(day, hourValue);
      if (shape.unit === 'hour') return span;
      const firstDayEnd = atHourInZone(
        addInterval(span.start, 1, 'day', timeZone),
        hourValue,
        timeZone,
      );
      return { start: span.start, end: span.end < firstDayEnd ? span.end : firstDayEnd };
    },
    [rangeFor, shape.unit, timeZone],
  );

  /**
   * Busy blocks from the phone's own calendar.
   *
   * `null` means "we do not know" — permission refused, or not yet answered —
   * and is deliberately distinct from `[]`, an empty fortnight.
   */
  const [deviceBusy, setDeviceBusy] = useState<TimeRange[] | null>(null);

  // One day past the last chip, so the last day's first night is covered.
  const searchTo = useMemo(
    () => addInterval(now, DAY_CHOICES + 1, 'day', timeZone),
    [now, timeZone],
  );

  useEffect(() => {
    void (async () => {
      if (!(await hasCalendarAccess())) return;
      setDeviceBusy(await readBusyBlocks(now, searchTo));
    })();
  }, [now, searchTo]);

  const plansQuery = usePlans(couple.id);
  // Reads nothing unless the reader turned cross-app busy on; the hook owns
  // that check so no screen can skip it.
  const serverBusy = useServerBusy(couple.id, now, searchTo);

  /**
   * Everything the screen knows about, coalesced once.
   *
   * `mergeRanges` sorts and joins, so overlapping answers from two sources —
   * this app's own plan, and the calendar entry it wrote for it — collapse into
   * one block rather than being counted twice.
   */
  const busy = useMemo(
    () =>
      mergeRanges([
        ...busyFromPlans(plansQuery.data ?? []),
        ...(deviceBusy ?? []),
        ...(serverBusy.data ?? []),
      ]),
    [plansQuery.data, deviceBusy, serverBusy.data],
  );

  // Each day judged at the currently chosen hour, and each hour on the
  // currently chosen day — so the marks answer "if I changed just this one
  // thing", which is the question a chip actually poses.
  const busyDays = useMemo(
    () => days.map((day) => overlapsAny(conflictRangeFor(day, chosenHour), busy)),
    [busy, days, conflictRangeFor, chosenHour],
  );

  const busyHours = useMemo(
    () =>
      HOUR_CHOICES.map((value) =>
        overlapsAny(conflictRangeFor(days[dayIndex] ?? now, value), busy),
      ),
    [busy, days, dayIndex, now, conflictRangeFor],
  );

  const anyBusy = busyDays.some(Boolean) || busyHours.some(Boolean);

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
                busy={busyDays[index]}
                accessibilityLabel={
                  busyDays[index]
                    ? t('app:plan.busyOption', { option: formatDay(day, locale, timeZone) })
                    : undefined
                }
                onPress={() => setDayIndex(index)}
              />
            ))}
          </View>
          {anyBusy ? <Muted>{t('app:plan.busyHint')}</Muted> : null}
        </View>
      </Card>

      <Card>
        <View className="gap-3">
          <Heading>{t('app:plan.startTime')}</Heading>
          <View className="flex-row gap-2">
            {HOUR_CHOICES.map((value, index) => {
              const label = formatTime(atHourInZone(startsAt, value, timeZone), locale, timeZone);
              return (
                <Chip
                  key={value}
                  label={label}
                  selected={chosenHour === value}
                  busy={busyHours[index]}
                  accessibilityLabel={
                    busyHours[index] ? t('app:plan.busyOption', { option: label }) : undefined
                  }
                  onPress={() => setHour(value)}
                />
              );
            })}
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
