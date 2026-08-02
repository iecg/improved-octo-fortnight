/**
 * The key hierarchy.
 *
 *   device identity keypair   X25519, per device, never leaves the keychain
 *          | static-static ECDH + HKDF          (see ./pairing)
 *   couple root key           32 random bytes, made once by the founding device
 *          | HKDF-SHA256, salted with the couple id
 *   domain content keys       one per scope: intimacy | two_two_two | shared
 *          | XChaCha20-Poly1305                 (see ./cipher)
 *   per-row payload
 *
 * The scope subkeys are the notable part. Until now the boundary between the
 * two apps held because `packages/data` filters every read on a domain and no
 * raw table client is exported — a convention, enforced by a test. Deriving a
 * separate content key per domain makes it arithmetic instead: the 2-2-2 app's
 * cipher cannot open an intimacy plan's payload even if a future bug hands it
 * the row.
 *
 * It is a defence against the code, not against the person. Anyone holding the
 * root key can derive every scope from it, and both partners hold the root key
 * by design.
 */
import type { AppDomain } from '@couple/core';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { utf8ToBytes } from './codec';
import { randomBytes, type RandomSource } from './random';

/**
 * Which key a payload is sealed under. `shared` is for rows both apps read —
 * today only a partner's display name.
 */
export type KeyScope = AppDomain | 'shared';

export const ROOT_KEY_BYTES = 32;
export const CONTENT_KEY_BYTES = 32;

/** X25519 scalar. Stated rather than read off `x25519.lengths`, which is typed loosely enough to be `undefined`. */
export const DEVICE_SECRET_KEY_BYTES = 32;

/**
 * Branded so a root key cannot be passed where a content key is expected. They
 * are both 32 bytes and confusing them would be silent.
 */
export type CoupleRootKey = Uint8Array & { readonly __brand: 'CoupleRootKey' };
export type ContentKey = Uint8Array & { readonly __brand: 'ContentKey' };

export interface DeviceKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateDeviceKeypair(random: RandomSource): DeviceKeypair {
  const secretKey = randomBytes(random, DEVICE_SECRET_KEY_BYTES);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function publicKeyFor(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

export function generateCoupleRootKey(random: RandomSource): CoupleRootKey {
  return randomBytes(random, ROOT_KEY_BYTES) as CoupleRootKey;
}

/**
 * The couple id is the salt rather than part of the info string so that two
 * couples never share a content key even in the event that a root key is
 * somehow reused.
 */
export function deriveContentKey(
  root: CoupleRootKey,
  coupleId: string,
  scope: KeyScope,
): ContentKey {
  return hkdf(
    sha256,
    root,
    utf8ToBytes(coupleId),
    utf8ToBytes(`couple-content/v1/${scope}`),
    CONTENT_KEY_BYTES,
  ) as ContentKey;
}
