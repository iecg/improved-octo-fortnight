/**
 * The proxy's contract, with no runtime behind it.
 *
 * Separate from `client.ts` so it can be imported without dragging in the
 * Supabase client and, through it, all of React Native — which matters because
 * `tests/guards/maps-optional.test.ts` imports this to assert that "no key
 * configured" is still a complete, working state, and that guard runs in plain
 * Node.
 *
 * Still inside `maps/`, because it describes a provider-shaped thing.
 */
import type { Coordinates } from '@couple/core';

/** What the proxy can do right now. All false is a complete, working state. */
export interface PlacesCapabilities {
  search: boolean;
  travelTime: boolean;
  staticMap: boolean;
}

/**
 * The state of every install until somebody configures a key — including every
 * one this repo's tests run against. Screens treat it as ordinary, not as an
 * error to report.
 */
export const NO_CAPABILITIES: PlacesCapabilities = {
  search: false,
  travelTime: false,
  staticMap: false,
};

export interface PlaceResult {
  providerPlaceId: string;
  name: string;
  address: string | null;
  coordinates: Coordinates | null;
}

/**
 * Reason codes, never sentences. The proxy has no idea which language the
 * person reading this speaks — the screen turns one of these into a translated
 * string, in the reader's own language.
 */
export type PlacesFailure =
  | 'not_configured'
  | 'rate_limited'
  | 'bad_request'
  | 'unauthenticated'
  | 'upstream'
  | 'unreachable';

export type PlacesOutcome<T> = { ok: true; data: T } | { ok: false; reason: PlacesFailure };
