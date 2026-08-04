/**
 * Sealing and opening, for the suites that talk to Postgres directly.
 *
 * These tests write rows as SQL rather than through `packages/data`, so they
 * need the cipher the repositories would otherwise have applied. This is the
 * real `@couple/crypto` — nothing here is a stand-in — with a couple key
 * derived from the couple id so a test can rebuild the same cipher without
 * threading key material through every helper.
 *
 * That shortcut is fine for the policy suite, where the crypto is incidental
 * and the question is who may touch which row. The end-to-end journey does
 * **not** use it: it runs the actual key exchange, because proving that two
 * independently derived keys open the same blob is most of the point.
 */
import {
  createCoupleKeyStore,
  createFieldCipher,
  type CoupleRootKey,
  type FieldCipher,
  type KeyScope,
  type RandomSource,
} from '@couple/crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { webcrypto } from 'node:crypto';

export const testRandom: RandomSource = (byteLength) =>
  webcrypto.getRandomValues(new Uint8Array(byteLength));

/** A couple key nobody has to remember. Test-only, obviously — it is a hash of a public id. */
export function testRootKey(coupleId: string): CoupleRootKey {
  return sha256(new TextEncoder().encode(`test-root|${coupleId}`)) as CoupleRootKey;
}

export function cipherFor(coupleId: string, scope: KeyScope = 'intimacy'): FieldCipher {
  return cipherWithKey(testRootKey(coupleId), coupleId, scope);
}

export function cipherWithKey(
  root: CoupleRootKey,
  coupleId: string,
  scope: KeyScope,
  epoch = 0,
): FieldCipher {
  const store = createCoupleKeyStore();
  store.set(root, coupleId, epoch);
  return createFieldCipher(store, scope, testRandom);
}

/** The payload a plan row needs, for tests that only care that one is present. */
export function sealPlan(
  coupleId: string,
  id: string,
  fields: { title?: string | null; notes?: string | null; location?: string | null } = {},
): string {
  return cipherFor(coupleId).seal(
    { title: fields.title ?? null, notes: fields.notes ?? null, location: fields.location ?? null },
    { table: 'plans', coupleId, id },
  );
}

export function sealCheckin(
  coupleId: string,
  profileId: string,
  onDate: string,
  fields: { interest: string; energy?: number | null; note?: string | null },
): string {
  return cipherFor(coupleId).seal(
    { interest: fields.interest, energy: fields.energy ?? null, note: fields.note ?? null },
    { table: 'checkins', coupleId, profileId, onDate },
  );
}

export function sealIdea(
  coupleId: string,
  id: string,
  fields: { title: string; summary?: string | null; locale?: string },
): string {
  return cipherFor(coupleId, 'two_two_two').seal(
    {
      title: fields.title,
      summary: fields.summary ?? null,
      url: null,
      estCostBand: null,
      locale: fields.locale ?? 'en',
    },
    { table: 'plan_ideas', coupleId, id },
  );
}

/** A uuid for rows whose payload binds to their id, so the test can mint one first. */
export function newId(): string {
  return cipherFor('00000000-0000-4000-8000-000000000000').newId();
}
