/**
 * The key hierarchy, and the store that holds the top of it.
 */
import { describe, expect, it } from 'vitest';

import { bytesEqual } from './codec';
import {
  deriveContentKey,
  generateCoupleRootKey,
  generateDeviceKeypair,
  publicKeyFor,
  ROOT_KEY_BYTES,
} from './keys';
import { randomBytes, type RandomSource } from './random';
import { createCoupleKeyStore, MissingCoupleKeyError } from './store';

function sequenceRandom(seed = 1): RandomSource {
  let counter = seed;
  return (byteLength) =>
    Uint8Array.from({ length: byteLength }, () => {
      counter = (counter * 1103515245 + 12345) % 2 ** 31;
      return (counter >>> 16) & 0xff;
    });
}

const COUPLE = '11111111-1111-4111-8111-111111111111';

describe('the random source', () => {
  it('refuses a source that returns the wrong number of bytes', () => {
    expect(() => randomBytes(() => new Uint8Array(4), 32)).toThrow(/expected 32/);
  });

  it('refuses a source that returns something else entirely', () => {
    expect(() => randomBytes(() => 'nope' as unknown as Uint8Array, 8)).toThrow(/Uint8Array/);
  });
});

describe('device keys', () => {
  it('derives the same public key from a secret every time', () => {
    const pair = generateDeviceKeypair(sequenceRandom(11));
    expect(bytesEqual(publicKeyFor(pair.secretKey), pair.publicKey)).toBe(true);
  });

  it('gives different devices different keys', () => {
    const a = generateDeviceKeypair(sequenceRandom(11));
    const b = generateDeviceKeypair(sequenceRandom(22));
    expect(bytesEqual(a.publicKey, b.publicKey)).toBe(false);
  });
});

describe('content keys', () => {
  const root = generateCoupleRootKey(sequenceRandom(7));

  it('makes a root key of the size the format expects', () => {
    expect(root.length).toBe(ROOT_KEY_BYTES);
  });

  it('is deterministic, so both partners derive the same one', () => {
    expect(
      bytesEqual(
        deriveContentKey(root, COUPLE, 'intimacy'),
        deriveContentKey(root, COUPLE, 'intimacy'),
      ),
    ).toBe(true);
  });

  it('separates the two apps', () => {
    expect(
      bytesEqual(
        deriveContentKey(root, COUPLE, 'intimacy'),
        deriveContentKey(root, COUPLE, 'two_two_two'),
      ),
    ).toBe(false);
  });

  it('separates shared rows from either app', () => {
    expect(
      bytesEqual(
        deriveContentKey(root, COUPLE, 'shared'),
        deriveContentKey(root, COUPLE, 'intimacy'),
      ),
    ).toBe(false);
  });

  it('separates couples, even from the same root', () => {
    expect(
      bytesEqual(
        deriveContentKey(root, COUPLE, 'intimacy'),
        deriveContentKey(root, '22222222-2222-4222-8222-222222222222', 'intimacy'),
      ),
    ).toBe(false);
  });
});

describe('the key store', () => {
  it('refuses to hand out a key before it has one', () => {
    const store = createCoupleKeyStore();

    expect(store.status()).toBe('absent');
    expect(() => store.contentKey('intimacy')).toThrow(MissingCoupleKeyError);
  });

  it('derives on demand and caches, since a list is one call per row', () => {
    const store = createCoupleKeyStore();
    store.set(generateCoupleRootKey(sequenceRandom(3)), COUPLE, 0);

    expect(store.status()).toBe('ready');
    expect(store.contentKey('intimacy')).toBe(store.contentKey('intimacy'));
    expect(store.coupleId).toBe(COUPLE);
    expect(store.epoch).toBe(0);
  });

  it('forgets everything on clear, and says so', () => {
    const store = createCoupleKeyStore();
    store.set(generateCoupleRootKey(sequenceRandom(3)), COUPLE, 2);
    store.clear();

    expect(store.status()).toBe('absent');
    expect(store.coupleId).toBeNull();
    expect(store.epoch).toBe(0);
    expect(() => store.contentKey('shared')).toThrow(MissingCoupleKeyError);
  });

  it('re-derives after being given a different key', () => {
    const store = createCoupleKeyStore();

    store.set(generateCoupleRootKey(sequenceRandom(3)), COUPLE, 0);
    const first = Uint8Array.from(store.contentKey('intimacy'));

    store.set(generateCoupleRootKey(sequenceRandom(4)), COUPLE, 0);
    expect(bytesEqual(first, store.contentKey('intimacy'))).toBe(false);
  });
});
