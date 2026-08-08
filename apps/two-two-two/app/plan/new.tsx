/**
 * Book one of the three.
 *
 * Without this screen the app can only ever count upwards — the clocks on the
 * rhythm tab have nothing to reset them. Everything is written straight to
 * `scheduled`, because there is no negotiation step here: a getaway either has
 * a date or it does not.
 *
 * Every answer on this screen already has one, so booking can be a single tap
 * on the pinned button. Three named days cover most of what anyone picks —
 * today, tomorrow, this weekend — with a fourth chip opening a sheet for
 * anything else; times and lengths are chips too. All of the date arithmetic
 * goes through `@couple/cadence` against the couple's timezone; none of it
 * happens here.
 *
 * The title and the place are behind a disclosure, closed. Neither is needed to
 * book anything, and the screen this replaced put seven cards between opening
 * it and the button at the bottom.
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
  nextWeekdayInZone,
  overlapsAny,
  type TimeRange,
} from '@couple/cadence';
import { TWO_TWO_TWO_KINDS, kindLabelKey, type AppDomain, type PlaceProvider } from '@couple/core';
import { hasCalendarAccess, readBusyBlocks } from '@couple/device';
import { formatDay, formatTime } from '@couple/i18n';
import {
  Body,
  Button,
  Card,
  Chip,
  Disclosure,
  Field,
  Heading,
  Muted,
  Screen,
  Title,
} from '@couple/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { DaySheet } from '../../src/DaySheet';
import { normalizeManualPlace } from '../../src/features/places/label';
import type { PlaceResult } from '../../src/features/places/maps/types';
import { PlaceSearch } from '../../src/features/places/PlaceSearch';
import { useCreatePlan, usePlaces, usePlans, useServerBusy } from '../../src/queries';
import { usePairedSession } from '../../src/session';

/**
 * How far ahead free/busy is fetched. Wider than any chip offers, because
 * "another day" can land anywhere in it.
 */
const BUSY_HORIZON_DAYS = 14;

/** Wall-clock start times offered, in the couple's timezone. */
const HOUR_CHOICES = [9, 12, 18, 20];

/** Saturday, for `nextWeekdayInZone`. */
const SATURDAY = 6;

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
  const params = useLocalSearchParams<{ kind?: string; title?: string; ideaId?: string }>();
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

  /**
   * A venue the shortlist already knows about.
   *
   * Arriving from an idea that was found on a map, this is where its
   * coordinates and provider id come back — so booking it keeps the map, the
   * drive time and the stay search instead of degrading to the name alone.
   * Undefined for every other route into this screen, which is most of them.
   */
  const placesQuery = usePlaces(couple.id);
  const ideaPlace = params.ideaId
    ? (placesQuery.data ?? []).find((candidate) => candidate.ideaId === params.ideaId)
    : undefined;

  /**
   * The day this starts on, as a date rather than an index into a list.
   *
   * There used to be fourteen chips, one per day, and they did not survive
   * contact with a phone: `Chip` fills its row, fourteen of them in a
   * `flex-wrap` shrank past their own text, and `Aug 16, 2026` rendered as a
   * column of single characters. Three named days and a picker is both the fix
   * and the better screen — nobody scans fourteen dates to find tomorrow.
   */
  const [day, setDay] = useState<Date>(now);
  const [picking, setPicking] = useState(false);
  const [hour, setHour] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const create = useCreatePlan(couple.id, profile.id);
  const shape = DURATIONS[kind] ?? DURATIONS.date_night!;

  // Falling back to the kind's default rather than storing it on selection
  // keeps switching kinds from stranding a 14-night date night.
  const chosenHour = hour ?? shape.defaultHour;
  const chosenDuration = duration ?? shape.values[0]!;

  /**
   * The days worth naming, stepped in the couple's timezone so DST cannot skew
   * them.
   *
   * Deduplicated by instant, because the weekend collides with the other two
   * for two days out of every seven: on a Friday it *is* tomorrow, and on a
   * Saturday it is today. Two chips meaning the same day, one of them
   * highlighted and one not, is worse than one chip.
   */
  const dayChoices = useMemo(() => {
    const candidates = [
      { key: 'app:plan.dayToday', date: now },
      { key: 'app:plan.dayTomorrow', date: addInterval(now, 1, 'day', timeZone) },
      { key: 'app:plan.dayWeekend', date: nextWeekdayInZone(now, SATURDAY, timeZone) },
    ];
    const seen = new Set<number>();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.date.getTime())) return false;
      seen.add(candidate.date.getTime());
      return true;
    });
  }, [now, timeZone]);

  /** Some other date, from the picker — so the last chip knows it is the live one. */
  const customDay = !dayChoices.some((choice) => choice.date.getTime() === day.getTime());

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
    () => rangeFor(day, chosenHour),
    [rangeFor, day, chosenHour],
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

  // One day past the horizon, so its first night is covered too.
  const searchTo = useMemo(
    () => addInterval(now, BUSY_HORIZON_DAYS + 1, 'day', timeZone),
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
    () => dayChoices.map((choice) => overlapsAny(conflictRangeFor(choice.date, chosenHour), busy)),
    [busy, dayChoices, conflictRangeFor, chosenHour],
  );

  /** Only meaningful once a date has actually been picked. */
  const busyCustom = customDay && overlapsAny(conflictRangeFor(day, chosenHour), busy);

  const busyHours = useMemo(
    () => HOUR_CHOICES.map((value) => overlapsAny(conflictRangeFor(day, value), busy)),
    [busy, day, conflictRangeFor],
  );

  const anyBusy = busyDays.some(Boolean) || busyHours.some(Boolean) || busyCustom;

  function durationLabel(value: number): string {
    return shape.unit === 'hour'
      ? t('app:plan.hours', { count: value })
      : t('app:plan.nights', { count: value });
  }

  /**
   * The place this booking will carry.
   *
   * Typed text wins, because it is what is on screen. With the field empty, an
   * idea's own place comes along instead — that is what keeps a venue found on
   * a map from decaying into its name between the shortlist and the booking.
   * Null when there is neither.
   *
   * Derived rather than copied into state on load: the place list arrives
   * asynchronously, and an effect that seeds a text field from a query is a
   * race with whoever is already typing into it.
   */
  const typedName = normalizeManualPlace(place);
  // A searched result only counts while the field still holds its name — if the
  // text was edited afterwards, what is on screen is what gets saved.
  const searched = found && found.name === typedName ? found : null;

  const chosenPlace = typedName
    ? {
        name: typedName,
        address: searched?.address ?? null,
        provider: (searched ? 'google' : 'manual') as PlaceProvider,
        providerPlaceId: searched?.providerPlaceId ?? null,
        coordinates: searched?.coordinates ?? null,
      }
    : ideaPlace
      ? {
          name: ideaPlace.name,
          address: ideaPlace.address,
          provider: ideaPlace.provider,
          providerPlaceId: ideaPlace.providerPlaceId,
          coordinates: ideaPlace.coordinates,
        }
      : null;

  async function save() {
    await create.mutateAsync({
      kind,
      title: title.trim() || null,
      startsAt,
      endsAt,
      place: chosenPlace
        ? {
            ...chosenPlace,
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
    <Screen
      /* Everything here already has a good answer, so the button that accepts
         them all belongs where it cannot be scrolled past. */
      footer={
        <>
          <Body>{t('app:plan.summary', { date: formatDay(startsAt, locale, timeZone) })}</Body>
          <Button
            label={t('app:plan.save')}
            loading={create.isPending}
            onPress={() => void save()}
          />
          <Button label={t('common:action.cancel')} variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
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

      {/* Day, time and length in one card, because they are one decision: every
          one of them is already answered, and this is where you change your
          mind about the answer rather than supply it. */}
      <Card>
        <View className="gap-4">
          <View className="gap-3">
            <Heading>{t('app:plan.when')}</Heading>
            {/* `fill={false}` is load-bearing in a wrapping row — see `Chip`. */}
            <View className="flex-row flex-wrap gap-2">
              {dayChoices.map((choice, index) => (
                <Chip
                  key={choice.key}
                  label={t(choice.key)}
                  fill={false}
                  selected={!customDay && day.getTime() === choice.date.getTime()}
                  busy={busyDays[index]}
                  accessibilityLabel={
                    busyDays[index]
                      ? t('app:plan.busyOption', { option: t(choice.key) })
                      : undefined
                  }
                  onPress={() => setDay(choice.date)}
                />
              ))}
              {/*
                Anything the three named days do not cover — and our own `Chip`,
                not the native control.

                Compact `RNDateTimePicker` renders a UIKit grey pill with the
                system tint, which sat in this row of flat outlined chips as
                obviously foreign: two visual languages in one control group.
                The chip is the trigger now and the picker lives in the sheet
                below, where looking like the platform is exactly right.
              */}
              <Chip
                label={customDay ? formatDay(day, locale, timeZone) : t('app:plan.dayPick')}
                fill={false}
                selected={customDay}
                busy={busyCustom}
                /*
                  Announces whatever it is showing. Hard-coding "another day"
                  here meant a screen reader kept offering to pick a date long
                  after one had been picked, while the chip beside it plainly
                  read `Aug 20, 2026`.
                */
                accessibilityLabel={
                  customDay
                    ? busyCustom
                      ? t('app:plan.busyOption', { option: formatDay(day, locale, timeZone) })
                      : formatDay(day, locale, timeZone)
                    : t('app:plan.dayPick')
                }
                onPress={() => setPicking(true)}
              />
            </View>

            <DaySheet
              visible={picking}
              value={day}
              minimumDate={now}
              label={t('app:plan.dayPick')}
              onChange={setDay}
              onClose={() => setPicking(false)}
            />
          </View>

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

          {anyBusy ? <Muted>{t('app:plan.busyHint')}</Muted> : null}
        </View>
      </Card>

      {/* Neither of these has to be answered to book anything, so neither is on
          screen until someone asks for it. A place that arrived with an idea
          opens it, because there is already something in there to see. */}
      <Disclosure label={t('app:plan.details')} defaultOpen={Boolean(ideaPlace)}>
        <Card>
          <View className="gap-4">
            {/* The hint sets the expectation that this reaches the partner untranslated. */}
            <Field
              label={t('app:plan.titleLabel')}
              hint={t('app:plan.titleHint')}
              value={title}
              onChangeText={setTitle}
              placeholder={t('app:plan.titlePlaceholder')}
            />

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
              {/* The address of whatever is actually coming along — a searched
                  result, or the place an idea arrived with. */}
              {chosenPlace?.address ? <Muted>{chosenPlace.address}</Muted> : null}
              {/* Came from the shortlist and nothing has been typed over it, so
                  say so rather than leaving an empty field looking like no place. */}
              {!typedName && ideaPlace ? <Muted>{ideaPlace.name}</Muted> : null}
              {/* Only worth asking once there is a place to share. */}
              {chosenPlace ? (
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
          </View>
        </Card>
      </Disclosure>
    </Screen>
  );
}
