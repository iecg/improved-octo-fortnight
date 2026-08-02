/**
 * The two providers, and the only place their differences live.
 *
 * They differ in exactly three ways, and every one of them is behind this
 * catalog: where the key goes (a bearer header vs a query parameter), the
 * shape of the request body, and where the model's text sits in the reply.
 * Everything downstream — parsing, validation, error mapping — is shared,
 * because both ultimately hand back a JSON *string* inside a different
 * envelope.
 *
 * Keys are the user's own, held in the device keychain, and go straight from
 * the device to the provider. Nothing here is ever sent to Supabase.
 */
import type { AiErrorCode } from './errors';
import { AiError } from './errors';
import type { PromptParts } from './prompt';

export const AI_PROVIDER_IDS = ['openrouter', 'gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  /** Already stringified. */
  body: string;
}

export interface AiProvider {
  readonly id: AiProviderId;
  /** SecureStore item name. Alphanumerics, `.`, `-` and `_` only. */
  readonly keyItem: string;
  readonly modelItem: string;
  readonly defaultModel: string;
  /** Where a user gets a key. Opened with `Linking`, never fetched. */
  readonly consoleUrl: string;
  /** A cheap local check, so an obviously wrong paste costs no round trip. */
  looksLikeKey(raw: string): boolean;
  buildRequest(input: { apiKey: string; model: string; prompt: PromptParts }): HttpRequest;
  /** `null` means the response was a success and should be parsed. */
  classifyStatus(status: number, bodyText: string): AiErrorCode | null;
  /** Pull the model's text out of the provider's envelope. */
  contentOf(bodyText: string): string;
}

/** Shared across both: only 401/403, 429 and 5xx mean the same thing everywhere. */
function commonStatus(status: number): AiErrorCode | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_down';
  return null;
}

function parseBody(bodyText: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null) throw new AiError('malformed');
    return parsed as Record<string, unknown>;
  } catch (cause) {
    throw cause instanceof AiError ? cause : new AiError('malformed', { cause });
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const openrouter: AiProvider = {
  id: 'openrouter',
  keyItem: 'api_key_openrouter',
  modelItem: 'ai_model_openrouter',
  defaultModel: 'openai/gpt-4o-mini',
  consoleUrl: 'https://openrouter.ai/keys',

  looksLikeKey: (raw) => raw.trim().startsWith('sk-'),

  buildRequest: ({ apiKey, model, prompt }) => ({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      // The key never appears in the URL for this provider.
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      response_format: { type: 'json_object' },
    }),
  }),

  classifyStatus: (status) => {
    const common = commonStatus(status);
    if (common !== null || (status >= 200 && status < 300)) return common;
    // Out of credit on the user's own account — worth its own sentence, since
    // the fix is topping up rather than anything in this app.
    if (status === 402) return 'quota';
    if (status === 404) return 'model_unavailable';
    if (status === 400) return 'invalid_request';
    return 'unknown';
  },

  contentOf: (bodyText) => {
    const body = parseBody(bodyText);
    const choices = body.choices;
    if (!Array.isArray(choices) || choices.length === 0) throw new AiError('malformed');

    const first = asRecord(choices[0]);
    if (first === null) throw new AiError('malformed');

    const finish = first.finish_reason;
    if (finish === 'content_filter') throw new AiError('refused');

    const message = asRecord(first.message);
    const content = message?.content;
    if (typeof content !== 'string') throw new AiError('malformed');
    return content;
  },
};

const gemini: AiProvider = {
  id: 'gemini',
  keyItem: 'api_key_gemini',
  modelItem: 'ai_model_gemini',
  defaultModel: 'gemini-2.0-flash',
  consoleUrl: 'https://aistudio.google.com/app/apikey',

  looksLikeKey: (raw) => raw.trim().length >= 20,

  buildRequest: ({ apiKey, model, prompt }) => ({
    // This provider takes the key as a query parameter. That is why no error
    // path in this feature is allowed to carry a URL: it would be a leaked key
    // in a crash log. `AiError` deliberately has nowhere to put one.
    url:
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: prompt.schema,
      },
    }),
  }),

  classifyStatus: (status, bodyText) => {
    const common = commonStatus(status);
    if (common !== null || (status >= 200 && status < 300)) return common;
    if (status === 404) return 'model_unavailable';
    if (status === 400) {
      // This provider reports a bad key as a 400 with a marker in the body,
      // where the other reports it as a 401. Same sentence for the user.
      return /API_KEY_INVALID|API key not valid/i.test(bodyText)
        ? 'unauthorized'
        : 'invalid_request';
    }
    return 'unknown';
  },

  contentOf: (bodyText) => {
    const body = parseBody(bodyText);

    const feedback = asRecord(body.promptFeedback);
    if (typeof feedback?.blockReason === 'string') throw new AiError('refused');

    const candidates = body.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) throw new AiError('malformed');

    const first = asRecord(candidates[0]);
    if (first === null) throw new AiError('malformed');
    if (first.finishReason === 'SAFETY' || first.finishReason === 'PROHIBITED_CONTENT') {
      throw new AiError('refused');
    }

    const content = asRecord(first.content);
    const parts = content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) throw new AiError('malformed');

    // A reply can arrive split across parts; joining is cheaper than assuming.
    const text = parts
      .map((part) => asRecord(part)?.text)
      .filter((value): value is string => typeof value === 'string')
      .join('');

    if (text.length === 0) throw new AiError('malformed');
    return text;
  },
};

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = { openrouter, gemini };

/** `ai:settings.provider.<id>` — built here so no screen names a provider. */
export function providerLabelKey(id: AiProviderId): string {
  return `ai:settings.provider.${id}`;
}
