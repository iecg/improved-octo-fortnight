/**
 * Sealing one key under another.
 *
 * Shared by the two places a couple key is handed over: to the partner's device
 * (`./pairing`, where the wrapping key comes from ECDH) and to a piece of paper
 * (`./recovery`, where it comes from scrypt over a generated code). Only the
 * derivation differs, so only the derivation lives in those files.
 *
 * Deliberately separate from `./cipher`. That format carries an epoch and is
 * built for row payloads that are read constantly; this one wraps a fixed 32
 * bytes, is read about twice in a couple's lifetime, and binds a completely
 * different AAD. Sharing a format between them would mean a header field that
 * means one thing here and another there.
 *
 *   offset  size    field
 *   0       1       wrap format version  0x01
 *   1       24      nonce
 *   25      n + 16  ciphertext || tag
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { CipherError } from './cipher';
import { concatBytes, fromBase64, toBase64 } from './codec';
import { randomBytes, type RandomSource } from './random';

export const WRAP_VERSION = 0x01;

const NONCE_BYTES = 24;
const TAG_BYTES = 16;

export function wrapWithKey(
  key: Uint8Array,
  secret: Uint8Array,
  aad: Uint8Array,
  random: RandomSource,
): string {
  const nonce = randomBytes(random, NONCE_BYTES);
  const sealed = xchacha20poly1305(key, nonce, aad).encrypt(secret);
  return toBase64(concatBytes(Uint8Array.of(WRAP_VERSION), nonce, sealed));
}

export function unwrapWithKey(key: Uint8Array, wrapped: string, aad: Uint8Array): Uint8Array {
  let raw: Uint8Array;
  try {
    raw = fromBase64(wrapped);
  } catch {
    throw new CipherError('wrapped key is not canonical base64');
  }

  if (raw.length < 1 + NONCE_BYTES + TAG_BYTES) throw new CipherError('wrapped key is too short');
  if (raw[0] !== WRAP_VERSION) throw new CipherError(`unknown wrap version ${raw[0]}`);

  try {
    return xchacha20poly1305(key, raw.subarray(1, 1 + NONCE_BYTES), aad).decrypt(
      raw.subarray(1 + NONCE_BYTES),
    );
  } catch {
    // Wrong recipient, wrong sender, wrong code, or altered bytes. Which one is
    // not something a caller can act on differently, and saying would be an
    // oracle. Never retry with a key that failed authentication.
    throw new CipherError('wrapped key failed authentication');
  }
}
