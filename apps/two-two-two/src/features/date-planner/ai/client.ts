/**
 * The one network call in the feature.
 *
 * Device straight to the provider, with the user's own key. Nothing is
 * proxied through Supabase, so there is no server of ours that could see a
 * key, log a prompt, or keep a transcript.
 *
 * `fetch` is injectable so the whole path — request shape, status mapping,
 * envelope unwrapping, validation — is testable in the default suite, which
 * has no network and no native modules.
 */
import { AiError, parseRetryAfter } from './errors';
import { extractIdeas, type SuggestedIdea } from './parse';
import { buildPrompt, type SuggestionRequest } from './prompt';
import { AI_PROVIDERS, type AiProviderId } from './providers';

/** Generous: some models are slow, and a spurious timeout reads as a bug. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** How many ideas we are willing to render, whatever the model returns. */
export const MAX_IDEAS = 5;

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface SuggestOptions {
  provider: AiProviderId;
  apiKey: string;
  /** Falls back to the provider's catalog default. */
  model?: string;
  request: SuggestionRequest;
  /** Aborting resolves `null` rather than throwing — see below. */
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/**
 * Suggestions, or `null` if the caller aborted.
 *
 * Abort resolves rather than throws so there is no `cancelled` error code to
 * translate — which keeps "every `AiErrorCode` has a key in both bundles" an
 * exact, testable statement. Everything else throws `AiError`.
 */
export async function requestSuggestions(options: SuggestOptions): Promise<SuggestedIdea[] | null> {
  const provider = AI_PROVIDERS[options.provider];
  const apiKey = options.apiKey.trim();
  if (apiKey.length === 0) throw new AiError('no_key');

  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const request = provider.buildRequest({
    apiKey,
    model: options.model?.trim() || provider.defaultModel,
    prompt: buildPrompt(options.request),
  });

  if (options.signal?.aborted) return null;

  // `AbortSignal.timeout()` is not reliably present on Hermes, and it would
  // not tell us *which* abort fired anyway. One controller, one flag.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const relayAbort = () => controller.abort();
  options.signal?.addEventListener('abort', relayAbort);

  let status: number;
  let bodyText: string;
  let retryAfter: number | undefined;

  try {
    const response = await doFetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    status = response.status;
    retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
    bodyText = await response.text();
  } catch (cause) {
    // Our deadline and the caller's cancellation surface as the same
    // AbortError, so the flags decide which one it was.
    if (timedOut) throw new AiError('timeout', { cause });
    if (options.signal?.aborted) return null;
    throw new AiError('network', { cause });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', relayAbort);
  }

  const failure = provider.classifyStatus(status, bodyText);
  if (failure !== null) throw new AiError(failure, { status, retryAfterSeconds: retryAfter });

  const ideas = extractIdeas(provider.contentOf(bodyText), MAX_IDEAS);
  if (ideas.length === 0) throw new AiError('empty');
  return ideas;
}
