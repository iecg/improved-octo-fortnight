/**
 * The key exchange, and the comparison that makes it worth anything.
 *
 * The safety-number tests are the important ones here. They are the executable
 * form of the argument in `./pairing`: a server that substitutes a public key
 * cannot make the two screens agree.
 */
import { describe, expect, it } from 'vitest';

import { CipherError } from './cipher';
import { generateCoupleRootKey, generateDeviceKeypair } from './keys';
import { safetyNumber, unwrapCoupleKey, wrapCoupleKey } from './pairing';
import type { RandomSource } from './random';

function sequenceRandom(seed = 1): RandomSource {
  let counter = seed;
  return (byteLength) =>
    Uint8Array.from({ length: byteLength }, () => {
      counter = (counter * 1103515245 + 12345) % 2 ** 31;
      return (counter >>> 16) & 0xff;
    });
}

const COUPLE = '11111111-1111-4111-8111-111111111111';

const alice = generateDeviceKeypair(sequenceRandom(11));
const bob = generateDeviceKeypair(sequenceRandom(22));
const eve = generateDeviceKeypair(sequenceRandom(33));

describe('the safety number', () => {
  it('is the same on both phones regardless of who asks first', () => {
    expect(safetyNumber(alice.publicKey, bob.publicKey, COUPLE)).toBe(
      safetyNumber(bob.publicKey, alice.publicKey, COUPLE),
    );
  });

  it('reads as twelve unambiguous characters in three groups', () => {
    const sas = safetyNumber(alice.publicKey, bob.publicKey, COUPLE);

    expect(sas).toMatch(
      /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/,
    );
    // No I, L, O or U: this gets read out loud.
    expect(sas).not.toMatch(/[ILOU]/);
  });

  /**
   * The whole point. If the server hands Alice its own key in place of Bob's,
   * her screen and his no longer agree, and the two people notice.
   */
  it('differs when a key is substituted', () => {
    const honest = safetyNumber(alice.publicKey, bob.publicKey, COUPLE);
    const substituted = safetyNumber(alice.publicKey, eve.publicKey, COUPLE);

    expect(substituted).not.toBe(honest);
  });

  it('differs between couples, so one cannot be replayed at another', () => {
    expect(safetyNumber(alice.publicKey, bob.publicKey, COUPLE)).not.toBe(
      safetyNumber(alice.publicKey, bob.publicKey, '22222222-2222-4222-8222-222222222222'),
    );
  });
});

describe('wrapping the couple key', () => {
  const root = generateCoupleRootKey(sequenceRandom(44));

  function wrapForBob(): string {
    return wrapCoupleKey({
      root,
      mySecret: alice.secretKey,
      myPublic: alice.publicKey,
      theirPublic: bob.publicKey,
      coupleId: COUPLE,
      epoch: 0,
      random: sequenceRandom(55),
    });
  }

  it('hands Bob exactly the key Alice made', () => {
    const opened = unwrapCoupleKey({
      wrapped: wrapForBob(),
      mySecret: bob.secretKey,
      myPublic: bob.publicKey,
      theirPublic: alice.publicKey,
      coupleId: COUPLE,
      epoch: 0,
    });

    expect(Array.from(opened)).toEqual(Array.from(root));
  });

  /** The negative the plan called for: a wrap is addressed, not broadcast. */
  it('will not open for a third device', () => {
    expect(() =>
      unwrapCoupleKey({
        wrapped: wrapForBob(),
        mySecret: eve.secretKey,
        myPublic: eve.publicKey,
        theirPublic: alice.publicKey,
        coupleId: COUPLE,
        epoch: 0,
      }),
    ).toThrow(CipherError);
  });

  /**
   * Static-static rather than a sealed box: the tag proves the wrap came from
   * a device holding Alice's secret. A server that made its own wrap to Bob's
   * public key gets caught here.
   */
  it('will not open if it did not come from the expected partner', () => {
    const fromEve = wrapCoupleKey({
      root,
      mySecret: eve.secretKey,
      myPublic: eve.publicKey,
      theirPublic: bob.publicKey,
      coupleId: COUPLE,
      epoch: 0,
      random: sequenceRandom(66),
    });

    expect(() =>
      unwrapCoupleKey({
        wrapped: fromEve,
        mySecret: bob.secretKey,
        myPublic: bob.publicKey,
        theirPublic: alice.publicKey,
        coupleId: COUPLE,
        epoch: 0,
      }),
    ).toThrow(CipherError);
  });

  it.each([
    ['a different couple', { coupleId: '22222222-2222-4222-8222-222222222222', epoch: 0 }],
    ['a different epoch', { coupleId: COUPLE, epoch: 1 }],
  ])('will not open under %s', (_label, override) => {
    expect(() =>
      unwrapCoupleKey({
        wrapped: wrapForBob(),
        mySecret: bob.secretKey,
        myPublic: bob.publicKey,
        theirPublic: alice.publicKey,
        ...override,
      }),
    ).toThrow(CipherError);
  });

  it('notices an altered wrap', () => {
    const wrapped = wrapForBob();
    const altered = `${wrapped.slice(0, 30)}${wrapped[30] === 'A' ? 'B' : 'A'}${wrapped.slice(31)}`;

    expect(() =>
      unwrapCoupleKey({
        wrapped: altered,
        mySecret: bob.secretKey,
        myPublic: bob.publicKey,
        theirPublic: alice.publicKey,
        coupleId: COUPLE,
        epoch: 0,
      }),
    ).toThrow(CipherError);
  });
});
