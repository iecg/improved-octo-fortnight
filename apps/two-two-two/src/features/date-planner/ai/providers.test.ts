import { describe, expect, it } from 'vitest';

import { AiError, isAiError } from './errors';
import { buildPrompt } from './prompt';
import { AI_PROVIDERS, AI_PROVIDER_IDS, providerLabelKey } from './providers';

const PROMPT = buildPrompt({ kind: 'date_night', locale: 'en', count: 3 });
const KEY = 'sk-test-abcdefghijklmnopqrstuvwxyz';

function request(id: (typeof AI_PROVIDER_IDS)[number]) {
  return AI_PROVIDERS[id].buildRequest({ apiKey: KEY, model: 'test-model', prompt: PROMPT });
}

describe('the provider catalog', () => {
  it('gives every provider its own keychain item', () => {
    const items = AI_PROVIDER_IDS.map((id) => AI_PROVIDERS[id].keyItem);
    expect(new Set(items).size).toBe(items.length);
  });

  it('builds a label key rather than letting a screen name a provider', () => {
    expect(providerLabelKey('gemini')).toBe('ai:settings.provider.gemini');
  });
});

describe('the bearer-header provider', () => {
  const { url, headers, body } = request('openrouter');

  it('sends the key as a bearer header', () => {
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  /** The whole reason this provider is the safer of the two to log. */
  it('keeps the key out of the URL', () => {
    expect(url).not.toContain(KEY);
    expect(url).not.toContain('key=');
  });

  it('sends the system and user prompts as separate messages', () => {
    const parsed = JSON.parse(body) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(parsed.model).toBe('test-model');
    expect(parsed.messages.map((message) => message.role)).toEqual(['system', 'user']);
  });

  it('maps each status to the sentence the user needs', () => {
    const { classifyStatus } = AI_PROVIDERS.openrouter;
    expect(classifyStatus(200, '')).toBeNull();
    expect(classifyStatus(401, '')).toBe('unauthorized');
    expect(classifyStatus(403, '')).toBe('unauthorized');
    expect(classifyStatus(402, '')).toBe('quota');
    expect(classifyStatus(404, '')).toBe('model_unavailable');
    expect(classifyStatus(400, '')).toBe('invalid_request');
    expect(classifyStatus(429, '')).toBe('rate_limited');
    expect(classifyStatus(503, '')).toBe('provider_down');
  });

  it('unwraps the envelope', () => {
    const envelope = JSON.stringify({ choices: [{ message: { content: '{"ideas":[]}' } }] });
    expect(AI_PROVIDERS.openrouter.contentOf(envelope)).toBe('{"ideas":[]}');
  });

  it('reports a filtered completion as a refusal, not a parse failure', () => {
    const filtered = JSON.stringify({
      choices: [{ finish_reason: 'content_filter', message: { content: '' } }],
    });
    try {
      AI_PROVIDERS.openrouter.contentOf(filtered);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isAiError(error) && error.code).toBe('refused');
    }
  });

  it('throws malformed on an envelope it does not recognise', () => {
    expect(() => AI_PROVIDERS.openrouter.contentOf('{"choices":[]}')).toThrow(AiError);
    expect(() => AI_PROVIDERS.openrouter.contentOf('not json')).toThrow(AiError);
  });
});

describe('the query-parameter provider', () => {
  const { url, headers, body } = request('gemini');

  it('sends the key as a query parameter', () => {
    expect(url).toContain(`key=${encodeURIComponent(KEY)}`);
  });

  it('sends no authorization header', () => {
    expect(headers.Authorization).toBeUndefined();
  });

  it('puts the model in the path, escaped', () => {
    expect(url).toContain('/models/test-model:generateContent');
  });

  it('sends the system prompt as an instruction rather than a message role', () => {
    const parsed = JSON.parse(body) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string }[];
      generationConfig: { responseMimeType: string };
    };
    expect(parsed.systemInstruction.parts[0]?.text).toBe(PROMPT.system);
    expect(parsed.contents.map((entry) => entry.role)).toEqual(['user']);
    expect(parsed.generationConfig.responseMimeType).toBe('application/json');
  });

  it('maps each status to the sentence the user needs', () => {
    const { classifyStatus } = AI_PROVIDERS.gemini;
    expect(classifyStatus(200, '')).toBeNull();
    expect(classifyStatus(429, '')).toBe('rate_limited');
    expect(classifyStatus(500, '')).toBe('provider_down');
  });

  /** This provider reports a bad key as a 400; the other reports it as a 401. */
  it('recognises a bad key hidden inside a 400', () => {
    const { classifyStatus } = AI_PROVIDERS.gemini;
    expect(classifyStatus(400, '{"error":{"status":"API_KEY_INVALID"}}')).toBe('unauthorized');
    expect(classifyStatus(400, '{"error":{"message":"API key not valid"}}')).toBe('unauthorized');
    expect(classifyStatus(400, '{"error":{"message":"bad field"}}')).toBe('invalid_request');
  });

  it('unwraps the envelope, joining split parts', () => {
    const envelope = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"ideas"' }, { text: ':[]}' }] } }],
    });
    expect(AI_PROVIDERS.gemini.contentOf(envelope)).toBe('{"ideas":[]}');
  });

  it('reports a blocked prompt as a refusal', () => {
    const blocked = JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } });
    try {
      AI_PROVIDERS.gemini.contentOf(blocked);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isAiError(error) && error.code).toBe('refused');
    }
  });

  it('reports a safety-stopped candidate as a refusal', () => {
    const stopped = JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] });
    try {
      AI_PROVIDERS.gemini.contentOf(stopped);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isAiError(error) && error.code).toBe('refused');
    }
  });

  it('throws malformed on an envelope it does not recognise', () => {
    expect(() => AI_PROVIDERS.gemini.contentOf('{"candidates":[]}')).toThrow(AiError);
  });
});
