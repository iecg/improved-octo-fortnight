/**
 * Failure modes of a suggestion request, as codes rather than sentences.
 *
 * Every error the user can see comes from this list, because the provider's
 * own error text is English and one of these two partners does not read
 * English. Same reasoning as the comment in `packages/auth/src/screens.tsx`:
 * a translation key, never a server string.
 *
 * The provider's response body is deliberately never carried on the error, and
 * neither is the request URL — the key rides in the query string for one of the
 * two providers, so a URL in a crash log is a leaked key.
 */

export const AI_ERROR_CODES = [
  /** No key stored for the selected provider. */
  'no_key',
  'unauthorized',
  /** Out of credit on the user's own account. */
  'quota',
  'rate_limited',
  'invalid_request',
  /** The configured model id is not one the provider knows. */
  'model_unavailable',
  'provider_down',
  'network',
  'timeout',
  /** The model's own safety filter declined. */
  'refused',
  /** 2xx, but not the shape we asked for. */
  'malformed',
  /** Well-formed, but nothing survived validation. */
  'empty',
  'unknown',
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  /**
   * A brand rather than `instanceof`. These objects cross a Babel/Hermes
   * boundary and get caught as `unknown` by react-query, where a prototype
   * check that silently fails would turn every failure into `unknown`.
   */
  readonly isAiError = true as const;
  readonly code: AiErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: AiErrorCode,
    options: { status?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    // The message is the code: there is nothing safe to put here.
    super(code, { cause: options.cause });
    this.name = 'AiError';
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isAiError(value: unknown): value is AiError {
  return typeof value === 'object' && value !== null && 'isAiError' in value;
}

/** The only route from a failure to something a partner reads. */
export function aiErrorKey(code: AiErrorCode): string {
  return `ai:error.${code}`;
}

/** Narrow an unknown thrown value to a code, so the UI always has one. */
export function aiErrorCodeOf(value: unknown): AiErrorCode {
  return isAiError(value) ? value.code : 'unknown';
}

/**
 * `Retry-After` is either a delay in seconds or an HTTP date. Only the numeric
 * form is honoured — resolving the date form needs a clock, and this module is
 * pure.
 */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header.trim(), 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
