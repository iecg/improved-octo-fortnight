/**
 * Looking a venue up, when there is something to look it up with.
 *
 * Renders `null` when the proxy says it cannot search — which is every install
 * until somebody configures a key, and which is why every screen that uses this
 * still works without it. The component never asks whether a key exists; it
 * asks the proxy what it can do, and the proxy is the only thing that knows.
 *
 * Two deliberate choices about privacy, both of which cost nothing:
 *
 *  - **Search near a town you type**, not near you. There is no location
 *    permission here and no `expo-location` dependency. The town is geocoded
 *    server-side and coarsened to about a kilometre before it reaches anyone.
 *  - **Submit on tap, never as you type.** Autocomplete would make every
 *    keystroke a billed request and a location signal. The cost of "improving"
 *    that later is invisible until a bill arrives, so it is written down here.
 */
import { Body, Button, Card, Divider, Heading, Muted } from '@couple/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { fetchTravelMinutes, geocodeTown, searchPlaces } from './maps/client';
import { usePlacesCapabilities } from './maps/useCapabilities';
import type { PlaceResult } from './maps/types';
import { driveBudgetFor, driveTimeLabel, withinDriveBudget } from './travel';

export interface PlaceSearchProps {
  /** Called with the venue the couple picked. */
  onPick: (result: PlaceResult) => void;
  /**
   * Which commitment this is for. Decides the drive budget: a getaway is worth
   * a couple of hours in the car, an evening out is not a distance question at
   * all. Omitted means no budget and no travel times.
   */
  kind?: string;
}

export function PlaceSearch({ onPick, kind }: PlaceSearchProps) {
  const { t, i18n } = useTranslation(['places', 'common']);
  const capabilities = usePlacesCapabilities();

  const [query, setQuery] = useState('');
  const [town, setTown] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [minutes, setMinutes] = useState<(number | null)[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'empty' | 'failed' | 'rateLimited'>(
    'idle',
  );

  // Nothing configured, nothing deployed, or no network — all the same here,
  // and all of them mean the screen simply does not offer search.
  if (!capabilities.search) return null;

  const languageCode = i18n.language === 'es' ? 'es' : 'en';

  const budget = kind ? driveBudgetFor(kind) : null;

  // Anything definitely beyond the budget drops out; anything whose journey we
  // could not measure stays, because unknown is not the same as too far.
  const shown = withinDriveBudget(results, minutes, minutes.length > 0 ? budget : null);

  async function run() {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;

    setStatus('searching');
    setResults([]);
    setMinutes([]);

    // The town rides along in the query rather than as a position: it is the
    // provider's own job to disambiguate "ramen in Girona", and it means no
    // coordinate leaves this device at all.
    const namedTown = town.trim();
    const phrase = namedTown ? `${trimmed}, ${namedTown}` : trimmed;
    const outcome = await searchPlaces({ query: phrase, languageCode });

    if (!outcome.ok) {
      setStatus(outcome.reason === 'rate_limited' ? 'rateLimited' : 'failed');
      return;
    }
    if (outcome.data.length === 0) {
      setStatus('empty');
      return;
    }

    setResults(outcome.data);
    setStatus('idle');

    /**
     * Drive times, measured from the town the couple named — which is the
     * question they were actually asking ("how far out of town is that?") and
     * which means this app never stores where they live nor asks the OS where
     * they are. Skipped entirely when this commitment has no budget.
     */
    if (!budget || !namedTown || !capabilities.travelTime) return;

    const origin = await geocodeTown(namedTown, languageCode);
    if (!origin) return;

    const destinations = outcome.data.map((result) => result.coordinates);
    if (destinations.some((value) => value === null)) return;

    const travel = await fetchTravelMinutes(origin, destinations as NonNullable<typeof destinations[number]>[]);
    // A failure here is not a failed search: the results are already on screen
    // and simply have no distance beside them.
    if (travel.ok) setMinutes(travel.data);
  }

  return (
    <Card>
      <View className="gap-2">
        <Heading>{t('places:search.title')}</Heading>

        <TextInput
          className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          value={query}
          onChangeText={setQuery}
          placeholder={t('places:search.queryPlaceholder')}
          accessibilityLabel={t('places:search.title')}
        />
        <TextInput
          className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          value={town}
          onChangeText={setTown}
          placeholder={t('places:search.townPlaceholder')}
          accessibilityLabel={t('places:search.nearATown')}
        />

        {/* Said before the request, not after it. */}
        <Muted>{t('places:privacy.notice')}</Muted>

        <Button
          label={status === 'searching' ? t('places:search.searching') : t('places:search.go')}
          variant="secondary"
          disabled={query.trim().length === 0}
          loading={status === 'searching'}
          onPress={() => void run()}
        />

        {status === 'empty' ? <Muted>{t('places:search.noResults')}</Muted> : null}
        {status === 'failed' ? <Muted>{t('places:search.failed')}</Muted> : null}
        {status === 'rateLimited' ? <Muted>{t('places:search.rateLimited')}</Muted> : null}

        {/* Only once there is something to say about distance. */}
        {budget && minutes.length > 0 ? (
          <Muted>{t('places:travel.within', { count: budget / 60 })}</Muted>
        ) : null}

        {shown.map((result) => {
          const index = results.indexOf(result);
          const drive = minutes[index] ?? null;
          return (
            <View key={result.providerPlaceId} className="gap-1 py-2">
              {index > 0 ? <Divider /> : null}
              {/* A venue's name is a proper noun; shown exactly as it came back. */}
              <Body>{result.name}</Body>
              {result.address ? <Muted>{result.address}</Muted> : null}
              {minutes.length > 0 ? (
                <Muted>
                  {t(driveTimeLabel(drive).key, { count: driveTimeLabel(drive).count })}
                </Muted>
              ) : null}
              <Button
                label={t('places:action.use')}
                variant="ghost"
                onPress={() => {
                  onPick(result);
                  setResults([]);
                  setMinutes([]);
                  setQuery('');
                }}
              />
            </View>
          );
        })}
      </View>
    </Card>
  );
}
