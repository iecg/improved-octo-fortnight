/**
 * The optional recovery code.
 *
 * Partner re-wrap is the primary path and covers every case except both devices
 * being lost at once. This covers that one, and it is offered rather than
 * required: a code that people are forced past during onboarding is a code that
 * ends up screenshotted into a camera roll, which is worse than not having one.
 *
 * ## Why the KDF choice is not load-bearing
 *
 * The code is **generated, never chosen** — 125 bits, five groups of five
 * Crockford symbols. That is what makes a pure-JS `scrypt(N = 2^14)` entirely
 * sufficient: memory-hardness matters when the secret is a human-chosen
 * password inside a small guessable space, and there is no such space here.
 * Argon2id at honest parameters in JS on Hermes would cost seconds and risk
 * running an older phone out of memory, to defend a secret that is already past
 * brute force by a wide margin.
 *
 * ## No wordlist
 *
 * A BIP-39-style phrase would need a language, and invariant 1 says one partner
 * reads Spanish. Symbols sidestep the question the way the invite code alphabet
 * already does.
 *
 * ## Why both functions are async
 *
 * `scryptAsync`, not `scrypt`, and the difference is visible rather than
 * academic. The synchronous version holds the JS thread for the whole
 * derivation — a few hundred milliseconds on a recent phone and worse on an old
 * one — during which React cannot paint. The screen that calls this shows a
 * `Button loading` spinner, and that spinner would sit frozen for exactly the
 * period it exists to explain, which reads as a dead tap rather than as work in
 * progress. `asyncTick` yields to the scheduler every 10 ms by default, so the
 * spinner spins.
 *
 * It costs both callers an `await` and makes the two exported functions
 * promise-returning. That is the whole price, and it is the right one: nothing
 * else in this package is slow enough to care, and this is the one operation a
 * user waits on.
 */
import { scryptAsync } from '@noble/hashes/scrypt.js';

import { CipherError } from './cipher';
import { fromBase64, toBase64, utf8ToBytes } from './codec';
import type { CoupleRootKey } from './keys';
import { randomBytes, type RandomSource } from './random';
import { unwrapWithKey, wrapWithKey } from './wrap';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 25 symbols x 5 bits = 125 bits. */
const RECOVERY_SYMBOLS = 25;
const RECOVERY_GROUP = 5;
const SALT_BYTES = 16;

export const RECOVERY_KDF = 'scrypt-v1' as const;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  dkLen: number;
}

/** ~16 MB, a few hundred milliseconds on Hermes. See the note above. */
export const SCRYPT_PARAMS: ScryptParams = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 };

/**
 * `K7M29-QXV3T-B5HN4-2PWRY-8CZGK`
 *
 * 32 divides 256 exactly, so taking each byte modulo the alphabet size is
 * uniform — no rejection sampling needed, unlike the invite code generator in
 * `20260802000100_pairing_hardening.sql`, whose alphabet is 30.
 */
export function generateRecoveryCode(random: RandomSource): string {
  const bytes = randomBytes(random, RECOVERY_SYMBOLS);

  const groups: string[] = [];
  for (let index = 0; index < RECOVERY_SYMBOLS; index += RECOVERY_GROUP) {
    let group = '';
    for (let step = 0; step < RECOVERY_GROUP; step += 1) {
      group += CROCKFORD[bytes[index + step]! % CROCKFORD.length];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/**
 * Crockford decoding: case-insensitive, hyphens ignored, and the ambiguous
 * glyphs folded the way someone reading a code aloud would mean them.
 */
export function normalizeRecoveryCode(code: string): string {
  const cleaned = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[ILil]/g, '1')
    .replace(/[Oo]/g, '0');

  if (cleaned.length !== RECOVERY_SYMBOLS) {
    throw new CipherError(`a recovery code has ${RECOVERY_SYMBOLS} characters`);
  }
  for (const character of cleaned) {
    if (!CROCKFORD.includes(character))
      throw new CipherError('recovery code has a stray character');
  }
  return cleaned;
}

export interface RecoveryEnvelope {
  kdf: typeof RECOVERY_KDF;
  salt: string;
  params: ScryptParams;
  wrapped: string;
}

async function stretch(code: string, salt: Uint8Array, params: ScryptParams): Promise<Uint8Array> {
  // Normalised *before* the await, so a malformed code fails immediately rather
  // than after the user has watched a spinner for half a second.
  const normalised = utf8ToBytes(normalizeRecoveryCode(code));

  return scryptAsync(normalised, salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: params.dkLen,
  });
}

export async function wrapWithRecoveryCode(args: {
  root: CoupleRootKey;
  code: string;
  coupleId: string;
  epoch: number;
  random: RandomSource;
}): Promise<RecoveryEnvelope> {
  const salt = randomBytes(args.random, SALT_BYTES);
  const key = await stretch(args.code, salt, SCRYPT_PARAMS);

  return {
    kdf: RECOVERY_KDF,
    salt: toBase64(salt),
    params: SCRYPT_PARAMS,
    wrapped: wrapWithKey(key, args.root, recoveryAad(args.coupleId, args.epoch), args.random),
  };
}

export async function unwrapWithRecoveryCode(args: {
  envelope: RecoveryEnvelope;
  code: string;
  coupleId: string;
  epoch: number;
}): Promise<CoupleRootKey> {
  if (args.envelope.kdf !== RECOVERY_KDF) {
    throw new CipherError(`unknown recovery kdf ${args.envelope.kdf}`);
  }

  let salt: Uint8Array;
  try {
    salt = fromBase64(args.envelope.salt);
  } catch {
    throw new CipherError('recovery salt is not canonical base64');
  }

  const key = await stretch(args.code, salt, args.envelope.params);

  // A mistyped code fails the Poly1305 tag. There is no separate checksum
  // because the tag already is one.
  return unwrapWithKey(
    key,
    args.envelope.wrapped,
    recoveryAad(args.coupleId, args.epoch),
  ) as CoupleRootKey;
}

function recoveryAad(coupleId: string, epoch: number): Uint8Array {
  return utf8ToBytes(`recovery|${coupleId}|${epoch}`);
}
