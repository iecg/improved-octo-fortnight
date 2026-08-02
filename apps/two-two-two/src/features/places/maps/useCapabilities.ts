/**
 * Whether any of this is available, as a hook.
 *
 * Asked once and cached for the session: the answer is a deployment fact, not
 * a per-render one, and a screen re-asking on every mount would spend a request
 * to be told the same thing. `retry: false` because the failure mode is not
 * transient — no key configured is a permanent no until someone changes it, and
 * "no network" already resolves to the same behaviour.
 *
 * Every consumer must treat all-false as ordinary. It is the state of every
 * install until somebody sets a key, and it is the state this repo's tests run
 * in.
 */
import { useQuery } from '@tanstack/react-query';

import { fetchCapabilities } from './client';
import { NO_CAPABILITIES, type PlacesCapabilities } from './types';

export function usePlacesCapabilities(): PlacesCapabilities {
  const { data } = useQuery({
    queryKey: ['places-capabilities'],
    queryFn: fetchCapabilities,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  return data ?? NO_CAPABILITIES;
}
