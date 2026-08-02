/**
 * Opening a place in whatever maps app the phone already has.
 *
 * This is a URL scheme, not an API: no key, no network from us, no account, no
 * request to anyone until the user taps. That is why it lives outside `maps/`
 * and why it is available whether or not a provider is configured — it is the
 * "map preview" that costs nothing.
 *
 * Coordinates are used when we have them, because a name alone is ambiguous
 * across cities. When we do not, the query is the label the couple typed, which
 * is exactly what they would have typed into a maps app themselves.
 */
import type { Coordinates } from '@couple/core';

export interface MapsLinkTarget {
  name: string;
  address?: string | null;
  coordinates?: Coordinates | null;
}

/**
 * iOS resolves `maps.apple.com` to Apple Maps and Android resolves the `geo:`
 * scheme to whatever the user has set as default. Neither hard-codes a
 * provider, which is the point.
 */
export function mapsLinkFor(target: MapsLinkTarget, platform: 'ios' | 'android'): string {
  const query = [target.name, target.address].filter(Boolean).join(', ');
  const encoded = encodeURIComponent(query);

  if (target.coordinates) {
    const { latitude, longitude } = target.coordinates;
    return platform === 'ios'
      ? `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encoded}`
      : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encoded})`;
  }

  return platform === 'ios' ? `https://maps.apple.com/?q=${encoded}` : `geo:0,0?q=${encoded}`;
}
