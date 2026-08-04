import { describe, expect, it } from 'vitest';

import {
  AI_ERROR_CODES,
  AiError,
  aiErrorCodeOf,
  aiErrorKey,
  isAiError,
  parseRetryAfter,
} from './errors';
import en from './locales/en/ai.json';
import es from './locales/es/ai.json';

describe('AiError', () => {
  it('is recognised by its brand, not by its prototype', () => {
    // These cross a Babel/Hermes boundary and arrive at react-query as
    // `unknown`; an `instanceof` that quietly failed would turn every failure
    // into "that did not work".
    const error = new AiError('rate_limited', { status: 429, retryAfterSeconds: 30 });
    expect(isAiError(error)).toBe(true);
    expect(isAiError(new Error('nope'))).toBe(false);
    expect(isAiError(null)).toBe(false);
    expect(isAiError('rate_limited')).toBe(false);
  });

  it('narrows anything thrown to a code the UI can render', () => {
    expect(aiErrorCodeOf(new AiError('timeout'))).toBe('timeout');
    expect(aiErrorCodeOf(new Error('boom'))).toBe('unknown');
    expect(aiErrorCodeOf(undefined)).toBe('unknown');
  });

  it('carries the code as its message and nothing else', () => {
    expect(new AiError('provider_down').message).toBe('provider_down');
  });
});

describe('parseRetryAfter', () => {
  it('reads the delay-seconds form', () => {
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter(' 5 ')).toBe(5);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('ignores the http-date form, which would need a clock', () => {
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
  });

  it('ignores nonsense and absence', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('-5')).toBeUndefined();
  });
});

/**
 * The bilingual invariant, for the one part of the feature the parity test
 * cannot reach: parity proves en and es agree with each other, not that either
 * covers every code the client can produce. A new code with no key renders as
 * raw dot-notation on someone's screen.
 */
describe('every failure has something to say, in both languages', () => {
  for (const code of AI_ERROR_CODES) {
    it(`${code} has a key in both bundles`, () => {
      expect(aiErrorKey(code)).toBe(`ai:error.${code}`);
      for (const [name, bundle] of [
        ['en', en],
        ['es', es],
      ] as const) {
        const message = (bundle.error as Record<string, string | undefined>)[code];
        expect(message, `${name}/ai.json is missing error.${code}`).toBeTruthy();
      }
    });
  }

  it('ships no error strings for codes that no longer exist', () => {
    expect(Object.keys(en.error).sort()).toEqual([...AI_ERROR_CODES].sort());
  });
});
