import { describe, expect, it, vi } from 'vitest';

import { requestSuggestions, type FetchLike } from './client';
import { isAiError, type AiErrorCode } from './errors';

const REQUEST = { kind: 'date_night', locale: 'en' as const, count: 3 };

const GOOD = JSON.stringify({
  ideas: [
    { title: 'Night market', summary: 'Eat standing up.', estCostBand: 'low' },
    { title: 'Late film', summary: 'The one neither would pick.', estCostBand: 'medium' },
  ],
});

function respond(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchLike {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => bodyText,
  }));
}

/** A successful reply in each provider's own envelope. */
function envelope(provider: 'openrouter' | 'gemini', content: string): string {
  return provider === 'openrouter'
    ? JSON.stringify({ choices: [{ message: { content } }] })
    : JSON.stringify({ candidates: [{ content: { parts: [{ text: content }] } }] });
}

async function codeOf(promise: Promise<unknown>): Promise<AiErrorCode | 'no-throw'> {
  try {
    await promise;
    return 'no-throw';
  } catch (error) {
    return isAiError(error) ? error.code : 'unknown';
  }
}

describe('requestSuggestions', () => {
  for (const provider of ['openrouter', 'gemini'] as const) {
    it(`returns validated ideas from ${provider}`, async () => {
      const ideas = await requestSuggestions({
        provider,
        apiKey: 'sk-key-that-is-long-enough-to-pass',
        request: REQUEST,
        fetchImpl: respond(200, envelope(provider, GOOD)),
      });
      expect(ideas).toEqual([
        { title: 'Night market', summary: 'Eat standing up.', estCostBand: 'low' },
        { title: 'Late film', summary: 'The one neither would pick.', estCostBand: 'medium' },
      ]);
    });
  }

  it('refuses to spend a round trip with no key', async () => {
    const fetchImpl = respond(200, envelope('openrouter', GOOD));
    expect(
      await codeOf(
        requestSuggestions({ provider: 'openrouter', apiKey: '   ', request: REQUEST, fetchImpl }),
      ),
    ).toBe('no_key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the catalog default when no model is configured', async () => {
    const fetchImpl = respond(200, envelope('openrouter', GOOD));
    await requestSuggestions({
      provider: 'openrouter',
      apiKey: 'sk-x',
      request: REQUEST,
      fetchImpl,
    });
    const [, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect((JSON.parse(init.body) as { model: string }).model).toBe('openai/gpt-4o-mini');
  });

  it('honours a configured model', async () => {
    const fetchImpl = respond(200, envelope('openrouter', GOOD));
    await requestSuggestions({
      provider: 'openrouter',
      apiKey: 'sk-x',
      model: 'anthropic/claude-3.5-haiku',
      request: REQUEST,
      fetchImpl,
    });
    const [, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect((JSON.parse(init.body) as { model: string }).model).toBe('anthropic/claude-3.5-haiku');
  });

  it('maps a rejected fetch to network, not to a crash', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    expect(
      await codeOf(
        requestSuggestions({
          provider: 'gemini',
          apiKey: 'long-enough-key-value',
          request: REQUEST,
          fetchImpl,
        }),
      ),
    ).toBe('network');
  });

  it('reports a rate limit and carries the retry delay', async () => {
    try {
      await requestSuggestions({
        provider: 'openrouter',
        apiKey: 'sk-x',
        request: REQUEST,
        fetchImpl: respond(429, '{}', { 'Retry-After': '42' }),
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isAiError(error) && error.code).toBe('rate_limited');
      expect(isAiError(error) && error.retryAfterSeconds).toBe(42);
    }
  });

  it('reports an empty but well-formed reply as empty, not malformed', async () => {
    expect(
      await codeOf(
        requestSuggestions({
          provider: 'openrouter',
          apiKey: 'sk-x',
          request: REQUEST,
          fetchImpl: respond(200, envelope('openrouter', '{"ideas":[]}')),
        }),
      ),
    ).toBe('empty');
  });

  it('never carries the response body or the URL on the error', async () => {
    // The key rides in the URL for one provider; an error that echoed either
    // would put it in a crash log.
    const secret = 'super-secret-key-value-here';
    try {
      await requestSuggestions({
        provider: 'gemini',
        apiKey: secret,
        request: REQUEST,
        fetchImpl: respond(500, 'upstream exploded'),
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const serialised = `${String(error)} ${(error as Error).message}`;
      expect(serialised).not.toContain(secret);
      expect(serialised).not.toContain('upstream exploded');
      expect(serialised).not.toContain('googleapis');
    }
  });

  it('resolves null when the caller aborts before the request starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = respond(200, envelope('openrouter', GOOD));
    const result = await requestSuggestions({
      provider: 'openrouter',
      apiKey: 'sk-x',
      request: REQUEST,
      signal: controller.signal,
      fetchImpl,
    });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves null when the caller aborts mid-flight', async () => {
    const controller = new AbortController();
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      controller.abort();
      throw Object.assign(new Error('Aborted'), { name: 'AbortError', signal: init.signal });
    });
    const result = await requestSuggestions({
      provider: 'openrouter',
      apiKey: 'sk-x',
      request: REQUEST,
      signal: controller.signal,
      fetchImpl,
    });
    expect(result).toBeNull();
  });

  /** Our own deadline and the caller's cancellation are the same AbortError. */
  it('distinguishes its own timeout from a cancellation', async () => {
    // Never resolves; only the abort listener ever settles it.
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
        );
      });
    expect(
      await codeOf(
        requestSuggestions({
          provider: 'openrouter',
          apiKey: 'sk-x',
          request: REQUEST,
          timeoutMs: 5,
          fetchImpl,
        }),
      ),
    ).toBe('timeout');
  });
});
