/**
 * Handing the couple key to the other device, and proving it went to the right
 * one.
 *
 * ## The wrap
 *
 * Static-static ECDH, not a sealed box with an ephemeral sender key. The
 * difference is the whole point: with a sealed box, anyone holding the
 * recipient's public key can produce a valid-looking wrap, so a malicious
 * server could hand a joining device *its own* couple key and then read
 * everything that device went on to write. Deriving from both static secrets
 * makes the Poly1305 tag proof that the wrap came from a device holding the
 * partner's identity secret.
 *
 * ## The safety number
 *
 * The server holds `device_keys` and can serve one partner a public key of its
 * own choosing in place of the other's. Nothing in the protocol prevents that,
 * because neither device has another channel to those bytes.
 *
 * What defeats it is that the safety number is a function of *both* public
 * keys, computed independently on each device from what that device can see.
 * Under substitution one screen shows SAS(mine, theirs) and the other shows
 * SAS(mine, the server's), and the two differ. The comparison then happens over
 * a channel the server does not control: two people looking at each other's
 * phones. This product is the most favourable possible setting for that — there
 * are only ever two of them, and they are together at exactly the moment the
 * exchange happens.
 *
 * Sixty bits, not the eight digits these UIs usually show. The attack is a
 * server grinding X25519 keypairs until one collides with the honest safety
 * number while it stalls the pairing screen; at ~27 bits that is under a second
 * on a GPU. Twelve unambiguous characters read aloud is the same ask this
 * product already makes with the eight-character invite code.
 *
 * Moving the full 32 bytes out of band with a QR code would remove the grinding
 * question entirely, and is the obvious upgrade once `expo-camera` is in.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, toBase64, utf8ToBytes } from './codec';
import type { CoupleRootKey } from './keys';
import type { RandomSource } from './random';
import { unwrapWithKey, wrapWithKey } from './wrap';

const WRAP_KEY_BYTES = 32;

/** Crockford's alphabet: no I, L, O or U, so a code read aloud is unambiguous. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const SAS_SYMBOLS = 12;
const SAS_GROUP = 4;

/**
 * Sorted so both devices derive the same value without having to agree on who
 * is the sender.
 */
function orderKeys(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index]! < b[index]!) return [a, b];
    if (a[index]! > b[index]!) return [b, a];
  }
  return a.length <= b.length ? [a, b] : [b, a];
}

/**
 * Twelve Crockford symbols — 60 bits — grouped for reading aloud.
 *
 * `K7M2-9QXV-3TB5`
 */
export function safetyNumber(a: Uint8Array, b: Uint8Array, coupleId: string): string {
  const [low, high] = orderKeys(a, b);
  const digest = sha256(concatBytes(utf8ToBytes(`sas/v1|${coupleId}`), low, high));

  let accumulator = 0n;
  for (let index = 0; index < 8; index += 1)
    accumulator = (accumulator << 8n) | BigInt(digest[index]!);
  accumulator >>= 4n; // keep the top 60 of those 64 bits

  const symbols: string[] = new Array(SAS_SYMBOLS);
  for (let index = SAS_SYMBOLS - 1; index >= 0; index -= 1) {
    symbols[index] = CROCKFORD[Number(accumulator & 31n)]!;
    accumulator >>= 5n;
  }

  const groups: string[] = [];
  for (let index = 0; index < SAS_SYMBOLS; index += SAS_GROUP) {
    groups.push(symbols.slice(index, index + SAS_GROUP).join(''));
  }
  return groups.join('-');
}

function wrapKey(
  mySecret: Uint8Array,
  theirPublic: Uint8Array,
  coupleId: string,
  epoch: number,
): Uint8Array {
  const shared = x25519.getSharedSecret(mySecret, theirPublic);
  return hkdf(
    sha256,
    shared,
    utf8ToBytes(coupleId),
    utf8ToBytes(`couple-key-wrap/v1/${epoch}`),
    WRAP_KEY_BYTES,
  );
}

/** Both public keys, sorted, so sender and recipient compute the same AAD. */
function wrapAad(coupleId: string, epoch: number, a: Uint8Array, b: Uint8Array): Uint8Array {
  const [low, high] = orderKeys(a, b);
  return utf8ToBytes(`wrap|${coupleId}|${epoch}|${toBase64(low)}|${toBase64(high)}`);
}

export interface WrapArgs {
  root: CoupleRootKey;
  mySecret: Uint8Array;
  myPublic: Uint8Array;
  theirPublic: Uint8Array;
  coupleId: string;
  epoch: number;
  random: RandomSource;
}

export function wrapCoupleKey(args: WrapArgs): string {
  return wrapWithKey(
    wrapKey(args.mySecret, args.theirPublic, args.coupleId, args.epoch),
    args.root,
    wrapAad(args.coupleId, args.epoch, args.myPublic, args.theirPublic),
    args.random,
  );
}

export interface UnwrapArgs {
  wrapped: string;
  mySecret: Uint8Array;
  myPublic: Uint8Array;
  theirPublic: Uint8Array;
  coupleId: string;
  epoch: number;
}

export function unwrapCoupleKey(args: UnwrapArgs): CoupleRootKey {
  // Throws on anything that is not a wrap from the expected partner to this
  // device: the tag is what makes it proof rather than assumption.
  return unwrapWithKey(
    wrapKey(args.mySecret, args.theirPublic, args.coupleId, args.epoch),
    args.wrapped,
    wrapAad(args.coupleId, args.epoch, args.myPublic, args.theirPublic),
  ) as CoupleRootKey;
}
