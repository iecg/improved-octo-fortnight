/**
 * The app's half of the places proxy.
 *
 * This directory — `features/<name>/maps/` — is the only place in the app that
 * may assume a mapping provider exists at all, which is what
 * `tests/guards/maps-optional.test.ts` enforces. Everything outside it works
 * with places typed by hand and never asks.
 *
 * Note what is absent: any key, any provider hostname, any environment
 * variable. The app cannot know whether a key is configured, because the key is
 * an Edge Function secret — so it asks, once, and believes the answer.
 *
 * There are no top-level side effects here. Importing this module makes no
 * request, which is why the guard can import it in a test with no network.
 */
import type { Coordinates } from '@couple/core';

import { supabase } from '../../../src/runtime';
import { NO_CAPABILITIES, type PlaceResult, type PlacesCapabilities, type PlacesOutcome } from './types';

export * from './types';

async function invoke<T>(body: Record<string, unknown>): Promise<PlacesOutcome<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('places', { body });
    if (error) return { ok: false, reason: 'unreachable' };
    if (typeof data !== 'object' || data === null) return { ok: false, reason: 'upstream' };
    return data as PlacesOutcome<T>;
  } catch {
    // No network, no function deployed, no project reachable — all the same
    // thing from here, and all of them mean "carry on without it".
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * One probe per session.
 *
 * Anything other than a clear yes is a no: an unreachable function, a project
 * with the function not deployed, and a project with no key configured are
 * indistinguishable from here and want the same behaviour.
 */
export async function fetchCapabilities(): Promise<PlacesCapabilities> {
  const outcome = await invoke<PlacesCapabilities>({ op: 'capabilities' });
  if (!outcome.ok) return NO_CAPABILITIES;
  return {
    search: Boolean(outcome.data.search),
    travelTime: Boolean(outcome.data.travelTime),
    staticMap: Boolean(outcome.data.staticMap),
  };
}

export interface SearchPlacesInput {
  query: string;
  /** Coarsened again on the server; sending a precise position is not possible. */
  near?: Coordinates | null;
  radiusMeters?: number;
  languageCode: 'en' | 'es';
}

export function searchPlaces(input: SearchPlacesInput): Promise<PlacesOutcome<PlaceResult[]>> {
  return invoke<PlaceResult[]>({
    op: 'search',
    query: input.query,
    ...(input.near ? { near: input.near } : {}),
    ...(input.radiusMeters ? { radiusMeters: input.radiusMeters } : {}),
    languageCode: input.languageCode,
  });
}

/** Whole minutes per destination, index-aligned. `null` means "we do not know". */
export function fetchTravelMinutes(
  origin: Coordinates,
  destinations: Coordinates[],
): Promise<PlacesOutcome<(number | null)[]>> {
  return invoke<(number | null)[]>({ op: 'travelTime', origin, destinations });
}
