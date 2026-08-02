/**
 * Asking for suggestions, and holding the answer just long enough to show it.
 *
 * Results live in mutation state, never in the query cache and never in a
 * table: a model's output should not land in the couple's shared shortlist
 * because one partner tapped a button. Saving is a second, deliberate tap, and
 * that is what writes a row.
 */
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { requestSuggestions } from './client';
import { AiError, aiErrorCodeOf, aiErrorKey } from './errors';
import { readProviderKey, readProviderModel } from './keys';
import type { SuggestedIdea } from './parse';
import type { SuggestionRequest } from './prompt';
import type { AiProviderId } from './providers';

export interface SuggestionsHandle {
  ideas: SuggestedIdea[];
  isPending: boolean;
  /** An `ai:error.*` key, or null. Never a sentence, never the provider's. */
  errorKey: string | null;
  generate(request: SuggestionRequest): void;
  dismiss(): void;
}

export function useSuggestions(provider: AiProviderId): SuggestionsHandle {
  const inFlight = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      // Leaving the screen cancels the request. `requestSuggestions` resolves
      // null on abort, so nothing tries to set state on the way out.
      inFlight.current?.abort();
    },
    [],
  );

  const mutation = useMutation<SuggestedIdea[] | null, unknown, SuggestionRequest>({
    mutationFn: async (request) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      const apiKey = await readProviderKey(provider);
      if (apiKey === null || apiKey.length === 0) throw new AiError('no_key');

      const model = await readProviderModel(provider);

      return requestSuggestions({
        provider,
        apiKey,
        model: model ?? undefined,
        request,
        signal: controller.signal,
      });
    },
    retry: false,
  });

  const { mutate, reset } = mutation;

  const generate = useCallback((request: SuggestionRequest) => mutate(request), [mutate]);

  const dismiss = useCallback(() => {
    inFlight.current?.abort();
    reset();
  }, [reset]);

  return {
    ideas: mutation.data ?? [],
    isPending: mutation.isPending,
    errorKey: mutation.isError ? aiErrorKey(aiErrorCodeOf(mutation.error)) : null,
    generate,
    dismiss,
  };
}
