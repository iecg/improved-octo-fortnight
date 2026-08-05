/**
 * The recovery code.
 *
 * Kept short on purpose: each round trip runs scrypt twice, and the point of
 * the parameters is that they are not free.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { CipherError } from './cipher';
import { generateCoupleRootKey } from './keys';
import type { RandomSource } from './random';
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  unwrapWithRecoveryCode,
  wrapWithRecoveryCode,
  type RecoveryEnvelope,
  type RECOVERY_KDF,
} from './recovery';

function sequenceRandom(seed = 1): RandomSource {
  let counter = seed;
  return (byteLength) =>
    Uint8Array.from({ length: byteLength }, () => {
      counter = (counter * 1103515245 + 12345) % 2 ** 31;
      return (counter >>> 16) & 0xff;
    });
}

const COUPLE = '11111111-1111-4111-8111-111111111111';

describe('the code itself', () => {
  it('reads as five groups of five unambiguous characters', () => {
    const code = generateRecoveryCode(sequenceRandom(5));

    expect(code).toMatch(/^([0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}-){4}[0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/);
    expect(code).not.toMatch(/[ILOU]/);
  });

  it('forgives the ways someone actually types it back', () => {
    const code = generateRecoveryCode(sequenceRandom(6));
    const canonical = normalizeRecoveryCode(code);

    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace(/-/g, ''))).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace(/-/g, ' '))).toBe(canonical);
  });

  it('folds the glyphs Crockford exists to disambiguate', () => {
    // Someone hearing "one" writes down I or l about as often as 1.
    expect(normalizeRecoveryCode('IIIII-OOOOO-11111-00000-ABCDE')).toBe(
      '11111000001111100000ABCDE',
    );
  });

  it.each([
    ['too short', 'ABCDE'],
    ['too long', 'ABCDE-ABCDE-ABCDE-ABCDE-ABCDE-ABCDE'],
    ['a character outside the alphabet', 'ABCDE-ABCDE-ABCDE-ABCDE-ABCD$'],
  ])('refuses %s', (_label, code) => {
    expect(() => normalizeRecoveryCode(code)).toThrow(CipherError);
  });
});

/**
 * Both halves are async because they run `scryptAsync` — the synchronous
 * variant would hold the JS thread for the whole derivation and freeze the very
 * spinner the screen puts up to explain the wait. Here that means the envelope
 * is built in `beforeAll` rather than at describe scope, and every refusal is a
 * rejection rather than a throw.
 */
describe('wrapping under it', () => {
  const root = generateCoupleRootKey(sequenceRandom(7));
  const code = generateRecoveryCode(sequenceRandom(8));
  let envelope: RecoveryEnvelope;

  beforeAll(async () => {
    envelope = await wrapWithRecoveryCode({
      root,
      code,
      coupleId: COUPLE,
      epoch: 0,
      random: sequenceRandom(9),
    });
  });

  it('gives the key back for the right code', async () => {
    const opened = await unwrapWithRecoveryCode({ envelope, code, coupleId: COUPLE, epoch: 0 });
    expect(Array.from(opened)).toEqual(Array.from(root));
  });

  it('accepts the code however it was typed back', async () => {
    const opened = await unwrapWithRecoveryCode({
      envelope,
      code: code.toLowerCase().replace(/-/g, ' '),
      coupleId: COUPLE,
      epoch: 0,
    });
    expect(Array.from(opened)).toEqual(Array.from(root));
  });

  /** The tag is the checksum — there is no separate one to get out of step. */
  it('refuses a mistyped code', async () => {
    const wrong = generateRecoveryCode(sequenceRandom(99));
    await expect(
      unwrapWithRecoveryCode({ envelope, code: wrong, coupleId: COUPLE, epoch: 0 }),
    ).rejects.toThrow(CipherError);
  });

  it('refuses it against a different couple', async () => {
    await expect(
      unwrapWithRecoveryCode({
        envelope,
        code,
        coupleId: '22222222-2222-4222-8222-222222222222',
        epoch: 0,
      }),
    ).rejects.toThrow(CipherError);
  });

  it('refuses a kdf it does not know, rather than guessing', async () => {
    await expect(
      unwrapWithRecoveryCode({
        envelope: { ...envelope, kdf: 'argon2id-v1' as typeof RECOVERY_KDF },
        code,
        coupleId: COUPLE,
        epoch: 0,
      }),
    ).rejects.toThrow(CipherError);
  });

  /**
   * A malformed code fails before the KDF runs, not after.
   *
   * `stretch` normalises ahead of the await deliberately: making someone watch
   * a spinner for half a second to be told their code is the wrong length is
   * worse than telling them at once, and the work is wasted either way.
   */
  it('rejects a malformed code without doing the work', async () => {
    const started = performance.now();
    await expect(
      unwrapWithRecoveryCode({ envelope, code: 'nope', coupleId: COUPLE, epoch: 0 }),
    ).rejects.toThrow(CipherError);
    expect(performance.now() - started).toBeLessThan(20);
  });
});
