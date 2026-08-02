/**
 * A map thumbnail for a place, when there is one to be had.
 *
 * Renders `null` in three cases, all of them ordinary: no key configured, no
 * coordinates on the place (which is every place typed by hand), and a request
 * that failed. A missing map is not an error worth telling anyone about — the
 * name, the address and "Open in Maps" are all still there.
 *
 * Fetched through the proxy as bytes and cached for the session by react-query,
 * keyed on the coordinates. A place does not move, so this is one request per
 * venue rather than one per render.
 */
import type { Coordinates } from '@couple/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Image } from 'react-native';

import { fetchStaticMap } from './client';
import { usePlacesCapabilities } from './useCapabilities';

export interface StaticMapProps {
  coordinates: Coordinates | null;
  width?: number;
  height?: number;
}

export function StaticMap({ coordinates, width = 400, height = 200 }: StaticMapProps) {
  const { t } = useTranslation(['places']);
  const capabilities = usePlacesCapabilities();

  const enabled = capabilities.staticMap && coordinates !== null;

  const { data } = useQuery({
    queryKey: ['static-map', coordinates?.latitude, coordinates?.longitude, width, height],
    queryFn: () => fetchStaticMap(coordinates!, width, height),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  if (!enabled || !data) return null;

  return (
    <Image
      source={{ uri: data }}
      accessibilityLabel={t('places:map.alt')}
      className="h-40 w-full rounded-xl"
      resizeMode="cover"
    />
  );
}
