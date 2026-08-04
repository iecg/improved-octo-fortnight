/**
 * Where a booked plan is happening, and changing it.
 *
 * A top-level component rather than one defined inside the plans screen's
 * render. That matters now that it holds a text field: a component declared
 * during render is a new type on every render, so React unmounts and remounts
 * it, and anything half-typed disappears the moment the plan list refetches.
 *
 * Everything here works with no mapping key configured. `PlaceSearch` renders
 * nothing without one, which leaves the text field as the whole of it, and the
 * map renders nothing without coordinates — which is every place typed by hand.
 */
import type { Plan, PlanPlace } from '@couple/core';
import { Body, Button, Chip, Divider, Muted } from '@couple/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, TextInput, View } from 'react-native';

import { normalizeManualPlace } from './label';
import { mapsLinkFor } from './link';
import { StaticMap } from './maps/StaticMap';
import type { PlaceResult } from './maps/types';
import { PlaceSearch } from './PlaceSearch';
import { airbnbSearchUrl, needsSomewhereToStay } from './stays';

export interface PlanPlaceCardProps {
  plan: Plan;
  place: PlanPlace | null;
  /** The reader's language, for labelling an address written in the other one. */
  locale: 'en' | 'es';
  timeZone: string;
  onAttach: (draft: {
    name: string;
    address?: string | null;
    provider: 'manual' | 'google';
    providerPlaceId?: string | null;
    coordinates?: { latitude: number; longitude: number } | null;
  }) => void;
  onRemove: () => void;
  onShareWithCalendar: (share: boolean) => void;
  busy?: boolean;
}

export function PlanPlaceCard({
  plan,
  place,
  locale,
  timeZone,
  onAttach,
  onRemove,
  onShareWithCalendar,
  busy,
}: PlanPlaceCardProps) {
  const { t } = useTranslation(['places', 'common']);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function attachTyped() {
    const name = normalizeManualPlace(draft);
    if (!name) return;
    onAttach({ name, provider: 'manual' });
    setDraft('');
    setAdding(false);
  }

  function attachFound(result: PlaceResult) {
    onAttach({
      name: result.name,
      address: result.address,
      provider: 'google',
      providerPlaceId: result.providerPlaceId,
      coordinates: result.coordinates,
    });
    setDraft('');
    setAdding(false);
  }

  if (!place) {
    if (!adding) {
      return (
        <Button label={t('places:action.add')} variant="ghost" onPress={() => setAdding(true)} />
      );
    }

    return (
      <View className="gap-2">
        <TextInput
          className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          value={draft}
          onChangeText={setDraft}
          placeholder={t('places:manual.placeholder')}
          accessibilityLabel={t('places:label')}
        />
        {/* Nothing at all when no mapping key is configured. */}
        <PlaceSearch kind={plan.kind} onPick={attachFound} />
        <View className="flex-row gap-2">
          <View className="grow basis-0">
            <Button
              label={t('common:action.save')}
              variant="secondary"
              disabled={normalizeManualPlace(draft) === null}
              loading={busy}
              onPress={attachTyped}
            />
          </View>
          <View className="grow basis-0">
            <Button
              label={t('common:action.cancel')}
              variant="ghost"
              onPress={() => {
                setDraft('');
                setAdding(false);
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  /**
   * Somewhere to stay, with the nights and the place already filled in — but
   * only for the two commitments that involve sleeping somewhere, and only once
   * the plan has a window to book.
   */
  const stayUrl =
    needsSomewhereToStay(plan.kind) && plan.startsAt && plan.endsAt
      ? airbnbSearchUrl({
          // The address is what a person would type into the site; a venue name
          // alone is not what you search for a bed near.
          where: place.address ?? place.name,
          startsAt: new Date(plan.startsAt),
          endsAt: new Date(plan.endsAt),
          timeZone,
        })
      : null;

  return (
    <View className="gap-1">
      {/* A venue name is a proper noun; shown exactly as it was written. */}
      <Body>{place.name}</Body>
      {place.address ? <Muted>{place.address}</Muted> : null}
      {/* Labelled, not translated, when the address is not in the reader's
          language — the same rule as a saved idea. */}
      {place.address && place.locale !== locale ? (
        <Muted>{t(`common:language.${place.locale}`)}</Muted>
      ) : null}

      {/* Nothing for a place typed by hand, or with no key set. */}
      <StaticMap coordinates={place.coordinates} />

      <Button
        label={t('places:action.openInMaps')}
        variant="ghost"
        onPress={() =>
          void Linking.openURL(
            // Whatever maps app the phone already has. No key, and no request
            // to anyone until this is tapped.
            mapsLinkFor(place, Platform.OS === 'ios' ? 'ios' : 'android'),
          )
        }
      />
      {stayUrl ? (
        <Button
          label={t('places:action.findAStay')}
          variant="ghost"
          // Airbnb has no API anyone can hold a key for, so this is a link and
          // nothing else — the search runs on their site, as them.
          onPress={() => void Linking.openURL(stayUrl)}
        />
      ) : null}

      <Divider />

      {/* Changeable after the fact, which is the point: the calendar entry is
          rewritten to match on the next reconciliation pass. */}
      <Chip
        label={t('places:calendar.share')}
        selected={place.shareWithCalendar}
        onPress={() => onShareWithCalendar(!place.shareWithCalendar)}
      />
      <Muted>{t('places:calendar.shareHint')}</Muted>

      <Button label={t('places:action.remove')} variant="ghost" loading={busy} onPress={onRemove} />
    </View>
  );
}
