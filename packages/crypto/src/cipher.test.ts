/**
 * The payload format, and what it refuses.
 *
 * Most of these are the same shape: seal something, then try to open it as
 * though it were a different row. Every one of those is a thing whoever runs
 * the database could try with nothing but UPDATE.
 */
import { describe, expect, it } from 'vitest';

import {
  CipherError,
  createFieldCipher,
  identityString,
  MAX_PLAINTEXT_BYTES,
  openWithKey,
  PayloadTooLargeError,
  sealWithKey,
  type RecordIdentity,
} from './cipher';
import { fromBase64, toBase64 } from './codec';
import { deriveContentKey, generateCoupleRootKey, type ContentKey } from './keys';
import type { RandomSource } from './random';
import { createCoupleKeyStore } from './store';

/**
 * Deterministic, so a failure reproduces — and so this package's tests need no
 * more of a runtime than the package does. Emphatically not a CSPRNG; nothing
 * outside a test may use this shape.
 */
function sequenceRandom(seed = 1): RandomSource {
  let counter = seed;
  return (byteLength) =>
    Uint8Array.from({ length: byteLength }, () => {
      counter = (counter * 1103515245 + 12345) % 2 ** 31;
      return (counter >>> 16) & 0xff;
    });
}

const COUPLE = '11111111-1111-4111-8111-111111111111';
const OTHER_COUPLE = '22222222-2222-4222-8222-222222222222';
const PLAN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_PLAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const planIdentity: RecordIdentity = { table: 'plans', coupleId: COUPLE, id: PLAN };

function contentKey(seed = 1): ContentKey {
  return deriveContentKey(generateCoupleRootKey(sequenceRandom(seed)), COUPLE, 'intimacy');
}

describe('the payload format', () => {
  it('round-trips the fields it was given', () => {
    const key = contentKey();
    const fields = { title: 'dinner', notes: 'Reservamos mesa — ¿vale? 🌙', location: null };

    const blob = sealWithKey(key, 0, fields, planIdentity, sequenceRandom(9));
    expect(openWithKey(() => key, blob, planIdentity)).toEqual(fields);
  });

  it('drops undefined rather than serialising it, and does not care about key order', () => {
    const key = contentKey();
    const random = sequenceRandom(4);

    const a = sealWithKey(key, 0, { title: 'x', notes: 'y' }, planIdentity, random);
    const b = sealWithKey(
      key,
      0,
      { notes: 'y', title: 'x', location: undefined },
      planIdentity,
      random,
    );

    expect(openWithKey(() => key, a, planIdentity)).toEqual(
      openWithKey(() => key, b, planIdentity),
    );
  });

  it('uses a fresh nonce every time, so identical content does not look identical', () => {
    const key = contentKey();
    const random = sequenceRandom(3);
    const fields = { title: 'the same thing' };

    expect(sealWithKey(key, 0, fields, planIdentity, random)).not.toBe(
      sealWithKey(key, 0, fields, planIdentity, random),
    );
  });

  it('declares its version and suite in the clear, for a future reader', () => {
    const raw = fromBase64(
      sealWithKey(contentKey(), 0, { title: 'x' }, planIdentity, sequenceRandom()),
    );
    expect(raw[0]).toBe(0x01);
    expect(raw[1]).toBe(0x01);
  });

  it('refuses a plaintext over the limit rather than truncating it', () => {
    expect(() =>
      sealWithKey(
        contentKey(),
        0,
        { notes: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1) },
        planIdentity,
        sequenceRandom(),
      ),
    ).toThrow(PayloadTooLargeError);
  });
});

describe('what the padding hides', () => {
  it('gives a one-word note and a much longer one the same size', () => {
    const key = contentKey();
    const random = sequenceRandom(7);

    const short = sealWithKey(key, 0, { note: 'yes' }, planIdentity, random);
    const longer = sealWithKey(
      key,
      0,
      { note: 'yes, and here is rather more of it' },
      planIdentity,
      random,
    );

    expect(short.length).toBe(longer.length);
  });

  it('hides whether an optional field is present at all', () => {
    const key = contentKey();
    const random = sequenceRandom(8);

    // The argument for one blob rather than a column each: `notes is null`
    // would otherwise be readable for every row in the table.
    const withNote = sealWithKey(
      key,
      0,
      { title: 'dinner', notes: 'bring the book' },
      planIdentity,
      random,
    );
    const without = sealWithKey(key, 0, { title: 'dinner' }, planIdentity, random);

    expect(withNote.length).toBe(without.length);
  });
});

describe('what the AAD refuses', () => {
  const key = contentKey();
  const blob = sealWithKey(key, 0, { title: 'dinner' }, planIdentity, sequenceRandom(2));

  it('will not open a plan payload as a different plan', () => {
    const moved: RecordIdentity = { table: 'plans', coupleId: COUPLE, id: OTHER_PLAN };
    expect(() => openWithKey(() => key, blob, moved)).toThrow(CipherError);
  });

  it('will not open it as another couple', () => {
    const moved: RecordIdentity = { table: 'plans', coupleId: OTHER_COUPLE, id: PLAN };
    expect(() => openWithKey(() => key, blob, moved)).toThrow(CipherError);
  });

  it('will not open it as a different table', () => {
    const moved: RecordIdentity = { table: 'plan_ideas', coupleId: COUPLE, id: PLAN };
    expect(() => openWithKey(() => key, blob, moved)).toThrow(CipherError);
  });

  it('will not open it with another couple key', () => {
    expect(() => openWithKey(() => contentKey(99), blob, planIdentity)).toThrow(CipherError);
  });

  it('will not open it with another scope key', () => {
    const root = generateCoupleRootKey(sequenceRandom(1));
    const twoTwoTwo = deriveContentKey(root, COUPLE, 'two_two_two');
    expect(() => openWithKey(() => twoTwoTwo, blob, planIdentity)).toThrow(CipherError);
  });

  it('notices a flipped byte anywhere in the payload', () => {
    const raw = fromBase64(blob);
    for (const offset of [0, 1, 3, 10, 35, raw.length - 1]) {
      const altered = Uint8Array.from(raw);
      altered[offset] = altered[offset]! ^ 0x01;
      expect(() => openWithKey(() => key, toBase64(altered), planIdentity)).toThrow(CipherError);
    }
  });

  it('refuses something that is not a payload at all', () => {
    expect(() => openWithKey(() => key, 'not base64!', planIdentity)).toThrow(CipherError);
    expect(() => openWithKey(() => key, toBase64(Uint8Array.of(1, 2, 3)), planIdentity)).toThrow(
      CipherError,
    );
  });
});

describe('the identity string', () => {
  it('keys a check-in by its natural key, not its id', () => {
    // record() upserts on (profile_id, on_date) and Postgres keeps the existing
    // row id on conflict, so an id-bound payload would fail to open on the
    // second check-in of the day.
    expect(
      identityString({
        table: 'checkins',
        coupleId: COUPLE,
        profileId: PLAN,
        onDate: '2026-08-02',
      }),
    ).toBe(`checkins|${COUPLE}|${PLAN}|2026-08-02`);
  });

  it('refuses a component that would make the string ambiguous', () => {
    expect(() => identityString({ table: 'plans', coupleId: 'a|b', id: PLAN })).toThrow(
      CipherError,
    );
    expect(() => identityString({ table: 'plans', coupleId: COUPLE, id: '' })).toThrow(CipherError);
  });
});

describe('a scoped cipher', () => {
  function ready(scope: 'intimacy' | 'two_two_two') {
    const store = createCoupleKeyStore();
    store.set(generateCoupleRootKey(sequenceRandom(5)), COUPLE, 0);
    return createFieldCipher(store, scope, sequenceRandom(6));
  }

  it('round-trips through the store', () => {
    const cipher = ready('intimacy');
    const blob = cipher.seal({ note: 'not tonight' }, planIdentity);
    expect(cipher.open(blob, planIdentity)).toEqual({ note: 'not tonight' });
  });

  /**
   * The domain boundary, made arithmetic. Until now it held because
   * `packages/data` filters every read on a domain; the 2-2-2 app's cipher now
   * cannot open an intimacy payload even when handed the row.
   */
  it("cannot open the other app's domain, even with the same root key", () => {
    const intimacy = ready('intimacy');
    const twoTwoTwo = ready('two_two_two');

    const blob = intimacy.seal({ note: 'not tonight' }, planIdentity);
    expect(() => twoTwoTwo.open(blob, planIdentity)).toThrow(CipherError);
  });

  it('refuses a payload from an epoch this device does not hold', () => {
    const store = createCoupleKeyStore();
    const root = generateCoupleRootKey(sequenceRandom(5));

    store.set(root, COUPLE, 1);
    const fromEpochOne = createFieldCipher(store, 'intimacy', sequenceRandom(6)).seal(
      { a: 1 },
      planIdentity,
    );

    store.set(root, COUPLE, 0);
    expect(() =>
      createFieldCipher(store, 'intimacy', sequenceRandom(6)).open(fromEpochOne, planIdentity),
    ).toThrow(CipherError);
  });
});
