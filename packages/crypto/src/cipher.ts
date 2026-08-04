/**
 * Sealing and opening a row's private fields.
 *
 * One blob per row rather than one ciphertext per column. The decisive reason
 * is not efficiency: with per-column ciphertext, `notes is null` tells whoever
 * reads this database whether a note exists on every plan in it, and for this
 * product that is close to the interesting bit. A single payload says "this row
 * has content" and nothing further. It also means one nonce, one tag and one
 * AAD per row instead of six, and that adding a private field stops being a
 * migration — the same argument CLAUDE.md already makes for `(domain, kind)`
 * being slugs.
 *
 * Wire format, base64 of:
 *
 *   offset  size    field
 *   0       1       format version    0x01
 *   1       1       suite             0x01 = XChaCha20-Poly1305
 *   2       4       key epoch, uint32 big-endian
 *   6       24      nonce
 *   30      n + 16  ciphertext || Poly1305 tag
 *
 * Bytes 0..5 are also the first six bytes of the AAD, so a version, suite or
 * epoch downgrade is refused by the tag rather than merely by the check below.
 *
 * XChaCha20-Poly1305 rather than AES-GCM because two devices generate nonces
 * without coordinating: 24 random bytes has room for that, and GCM's 12 does
 * not, with no counter space to partition between an unbounded number of
 * devices. It is also constant-time in pure JS, which AES is not.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { bytesToUtf8, concatBytes, fromBase64, toBase64, utf8ToBytes } from './codec';
import type { ContentKey, KeyScope } from './keys';
import { randomBytes, type RandomSource } from './random';
import type { CoupleKeyStore } from './store';
import { randomUuid } from './uuid';

export const PAYLOAD_VERSION = 0x01;
export const SUITE_XCHACHA20_POLY1305 = 0x01;

const HEADER_BYTES = 6;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const LENGTH_PREFIX_BYTES = 4;

/**
 * Plaintext is padded up to a multiple of this before sealing. Without it,
 * `length(payload)` gives a reader of the table the note's length to the byte.
 * Bucketing blunts that; it does not remove it, and a very long note is still
 * visibly long.
 */
const PAD_BUCKET = 64;

/** Generous. The real per-field limits belong with the repositories. */
export const MAX_PLAINTEXT_BYTES = 16384;

export class CipherError extends Error {}
export class PayloadTooLargeError extends Error {}

/**
 * What a payload is bound to.
 *
 * Check-ins are keyed by `(profile_id, on_date)` rather than by `id` on
 * purpose: `createCheckinRepository.record()` upserts with
 * `onConflict: 'profile_id,on_date'`, and on conflict Postgres keeps the
 * existing row's id and discards the one the client sent. A payload bound to a
 * client-generated id would therefore open on the first tap of the day and fail
 * on the second.
 */
export type RecordIdentity =
  | { table: 'plans'; coupleId: string; id: string }
  | { table: 'plan_ideas'; coupleId: string; id: string }
  | { table: 'checkins'; coupleId: string; profileId: string; onDate: string }
  | { table: 'profiles'; coupleId: string; profileId: string };

function component(value: string, field: string): string {
  // Every component is a uuid or an ISO date today. Refusing the separator
  // outright keeps the canonical string unambiguous if that ever stops being
  // true, rather than letting two different identities encode the same way.
  if (value.includes('|')) throw new CipherError(`${field} may not contain "|"`);
  if (value.length === 0) throw new CipherError(`${field} may not be empty`);
  return value;
}

/**
 * The identity an AAD commits to. The table name is in it, so ciphertext cannot
 * be moved between tables; the couple id, so it cannot be moved between
 * couples; the row key, so it cannot be moved between rows.
 */
export function identityString(identity: RecordIdentity): string {
  const couple = component(identity.coupleId, 'coupleId');

  switch (identity.table) {
    case 'plans':
    case 'plan_ideas':
      return `${identity.table}|${couple}|${component(identity.id, 'id')}`;
    case 'checkins':
      return `checkins|${couple}|${component(identity.profileId, 'profileId')}|${component(
        identity.onDate,
        'onDate',
      )}`;
    case 'profiles':
      return `profiles|${couple}|${component(identity.profileId, 'profileId')}`;
  }
}

function header(epoch: number): Uint8Array {
  if (!Number.isInteger(epoch) || epoch < 0 || epoch > 0xffffffff) {
    throw new CipherError(`epoch ${epoch} is out of range`);
  }
  const bytes = new Uint8Array(HEADER_BYTES);
  bytes[0] = PAYLOAD_VERSION;
  bytes[1] = SUITE_XCHACHA20_POLY1305;
  new DataView(bytes.buffer).setUint32(2, epoch, false);
  return bytes;
}

/** Sorted keys, and `undefined` dropped rather than serialised as absent-ish. */
function canonicalJson(fields: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(fields).sort()) {
    if (fields[key] !== undefined) sorted[key] = fields[key];
  }
  return JSON.stringify(sorted);
}

function frame(json: string): Uint8Array {
  const body = utf8ToBytes(json);
  if (body.length > MAX_PLAINTEXT_BYTES) {
    throw new PayloadTooLargeError(
      `payload is ${body.length} bytes, over the ${MAX_PLAINTEXT_BYTES} limit`,
    );
  }

  const used = LENGTH_PREFIX_BYTES + body.length;
  const padded = Math.ceil(used / PAD_BUCKET) * PAD_BUCKET;

  const out = new Uint8Array(padded);
  new DataView(out.buffer).setUint32(0, body.length, false);
  out.set(body, LENGTH_PREFIX_BYTES);
  return out;
}

function unframe(bytes: Uint8Array): string {
  if (bytes.length < LENGTH_PREFIX_BYTES) throw new CipherError('payload frame is too short');

  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  if (LENGTH_PREFIX_BYTES + length > bytes.length) {
    throw new CipherError('payload frame length is out of range');
  }

  return bytesToUtf8(bytes.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length));
}

export function sealWithKey(
  key: ContentKey,
  epoch: number,
  fields: Record<string, unknown>,
  identity: RecordIdentity,
  random: RandomSource,
): string {
  const head = header(epoch);
  const nonce = randomBytes(random, NONCE_BYTES);
  const aad = concatBytes(head, utf8ToBytes(identityString(identity)));
  const sealed = xchacha20poly1305(key, nonce, aad).encrypt(frame(canonicalJson(fields)));

  return toBase64(concatBytes(head, nonce, sealed));
}

export function openWithKey(
  keyForEpoch: (epoch: number) => ContentKey,
  blob: string,
  identity: RecordIdentity,
): Record<string, unknown> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(blob);
  } catch {
    throw new CipherError('payload is not canonical base64');
  }

  if (raw.length < HEADER_BYTES + NONCE_BYTES + TAG_BYTES) {
    throw new CipherError('payload is too short to be sealed');
  }

  const head = raw.subarray(0, HEADER_BYTES);
  if (head[0] !== PAYLOAD_VERSION) throw new CipherError(`unknown payload version ${head[0]}`);
  if (head[1] !== SUITE_XCHACHA20_POLY1305) throw new CipherError(`unknown suite ${head[1]}`);

  const epoch = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(2, false);
  const key = keyForEpoch(epoch);

  const nonce = raw.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  const sealed = raw.subarray(HEADER_BYTES + NONCE_BYTES);
  const aad = concatBytes(head, utf8ToBytes(identityString(identity)));

  let plain: Uint8Array;
  try {
    plain = xchacha20poly1305(key, nonce, aad).decrypt(sealed);
  } catch {
    // Wrong key, wrong identity, or tampering. Which one it is is not something
    // the caller can act on differently, and saying would be an oracle.
    throw new CipherError('payload failed authentication');
  }

  return JSON.parse(unframe(plain)) as Record<string, unknown>;
}

/**
 * A cipher fixed to one scope.
 *
 * The scope is taken at construction and never per call, exactly as the
 * repositories take their domain — the shape invariant 2 forbids there is
 * forbidden here too, and for the same reason.
 */
export interface FieldCipher {
  readonly scope: KeyScope;
  seal(fields: Record<string, unknown>, identity: RecordIdentity): string;
  open(blob: string, identity: RecordIdentity): Record<string, unknown>;
  /**
   * A row id for a table whose AAD binds to one.
   *
   * It lives here rather than in the repository because the id has to exist
   * before the payload can be sealed, and because a cipher already holds the
   * one random source — two sources would be two things to get right.
   */
  newId(): string;
}

export function createFieldCipher(
  store: CoupleKeyStore,
  scope: KeyScope,
  random: RandomSource,
): FieldCipher {
  function keyForEpoch(epoch: number): ContentKey {
    // There is one epoch today. When rotation lands, this is where an older
    // key would be looked up; until then, refusing is better than opening a
    // payload with a key that merely happens to be current.
    if (epoch !== store.epoch) {
      throw new CipherError(`payload is from epoch ${epoch}, this device holds ${store.epoch}`);
    }
    return store.contentKey(scope);
  }

  return {
    scope,

    seal(fields, identity) {
      return sealWithKey(store.contentKey(scope), store.epoch, fields, identity, random);
    },

    open(blob, identity) {
      return openWithKey(keyForEpoch, blob, identity);
    },

    newId() {
      return randomUuid(random);
    },
  };
}
