import {
  bytesEqual,
  createCoupleKeyStore,
  fromBase64,
  generateDeviceKeypair,
  safetyNumber,
  toBase64,
  type CoupleKeyVault,
  type DeviceKeypair,
  type RandomSource,
  type StoredCoupleKey,
} from '@couple/crypto';
import type { CoupleKeyWrap, DeviceKey, KeyRepository } from '@couple/data';
import { beforeEach, describe, expect, it } from 'vitest';

import { createKeyService, type KeyService } from './keys';

/**
 * The key exchange, against the real `@couple/crypto`.
 *
 * Nothing here is stubbed except the two things that cannot run in Node: the
 * database and the keychain. Every wrap is a real wrap and every unwrap really
 * has to authenticate, so a test that passes is a statement about the protocol
 * rather than about the mocks.
 */

const COUPLE = '11111111-1111-4111-8111-111111111111';
const OTHER_COUPLE = '22222222-2222-4222-8222-222222222222';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Deterministic, so a failure is reproducible; distinct per seed. */
function counterRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return (byteLength: number) =>
    Uint8Array.from({ length: byteLength }, () => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return (state >>> 16) & 0xff;
    });
}

/** The two key tables, shared by every device in a test. */
function fakeDatabase() {
  const devices: DeviceKey[] = [];
  const wraps: CoupleKeyWrap[] = [];
  let nextId = 0;

  const repository: KeyRepository = {
    async listDeviceKeys() {
      return devices.map((device) => ({ ...device }));
    },
    async publishDeviceKey(profileId, publicKey) {
      const existing = devices.find(
        (device) => device.profileId === profileId && device.publicKey === publicKey,
      );
      if (existing) return { ...existing };

      nextId += 1;
      const row: DeviceKey = {
        id: `device-${nextId}`,
        profileId,
        publicKey,
        createdAt: `2026-08-0${nextId}T00:00:00.000Z`,
      };
      devices.push(row);
      return { ...row };
    },
    async deleteDeviceKey(id) {
      const at = devices.findIndex((device) => device.id === id);
      if (at >= 0) devices.splice(at, 1);

      // `couple_key_wraps.device_key_id` is `on delete cascade`, so a fake that
      // kept the wraps would be a fake of a different schema — and the one
      // thing worth asserting about a revoked device is that its wraps went
      // with it.
      for (let i = wraps.length - 1; i >= 0; i -= 1) {
        if (wraps[i]!.deviceKeyId === id) wraps.splice(i, 1);
      }
    },

    async listWraps() {
      return wraps.map((wrap) => ({ ...wrap }));
    },
    async putWrap(input) {
      const clash = wraps.some(
        (wrap) => wrap.deviceKeyId === input.deviceKeyId && wrap.epoch === input.epoch,
      );
      if (clash) return;
      wraps.push({
        deviceKeyId: input.deviceKeyId,
        epoch: input.epoch,
        wrappedKey: input.wrappedKey,
        wrappedBy: input.wrappedBy,
      });
    },
    watchKeys() {
      return () => {};
    },
  };

  return { devices, wraps, repository };
}

function memoryVault(): CoupleKeyVault {
  let device: DeviceKeypair | null = null;
  let couple: StoredCoupleKey | null = null;

  return {
    async readDeviceKey() {
      return device;
    },
    async writeDeviceKey(keypair) {
      device = keypair;
    },
    async readCoupleKey() {
      return couple;
    },
    async writeCoupleKey(entry) {
      couple = entry;
    },
    async clearCoupleKey() {
      couple = null;
    },
  };
}

/** One installation: its own keychain and its own in-memory key store. */
function device(repository: KeyRepository, seed: number) {
  const vault = memoryVault();
  const keyStore = createCoupleKeyStore();
  const service: KeyService = createKeyService({
    keys: repository,
    vault,
    keyStore,
    random: counterRandom(seed),
  });
  return { vault, keyStore, service };
}

describe('createKeyService', () => {
  let db: ReturnType<typeof fakeDatabase>;
  let founder: ReturnType<typeof device>;

  beforeEach(() => {
    db = fakeDatabase();
    founder = device(db.repository, 1);
  });

  it('leaves the founding device holding the key it minted', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    expect(founder.keyStore.status()).toBe('ready');
    expect(founder.keyStore.coupleId).toBe(COUPLE);

    const stored = await founder.vault.readCoupleKey();
    expect(stored?.coupleId).toBe(COUPLE);
    expect(stored?.epoch).toBe(0);
  });

  it('does not list the founding device as waiting for itself', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);
    // Directly, by comparing public keys: a device is "not me" because its key
    // is not mine, which stays true even if its wrap row is missing.
    expect(await founder.service.visibleDevices(COUPLE, ALICE)).toEqual([]);
    expect(await founder.service.pendingDevices(COUPLE, ALICE)).toEqual([]);
  });

  it('does not offer to re-approve a device that already holds the key', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const secondApp = device(db.repository, 3);
    await secondApp.service.ensureDeviceKey(ALICE);
    const waiting = await founder.service.pendingDevices(COUPLE, ALICE);
    await founder.service.verifyAndWrap(COUPLE, ALICE, waiting[0]!);
    await secondApp.service.tryAdoptWrap(COUPLE, ALICE);

    // Seen from the newly admitted device, the founder must not look like it is
    // waiting. Its self-wrap is the only thing that says so — "holds the key" is
    // a fact about a keychain, and a wrap row is its only shadow on the server.
    expect(await secondApp.service.pendingDevices(COUPLE, ALICE)).toEqual([]);
  });

  it('shows the waiting device the same number, without the key', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);

    // The whole point of `visibleDevices` being key-free: the person who cannot
    // get in still has something to read aloud. If only the approver could
    // compute it, the comparison would be one-sided and prove nothing.
    expect(joiner.keyStore.status()).toBe('absent');
    const theirs = await joiner.service.visibleDevices(COUPLE, BOB);
    const ours = await founder.service.pendingDevices(COUPLE, ALICE);

    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.safetyNumber).toBe(ours[0]!.safetyNumber);
    expect(theirs[0]!.isMine).toBe(false);
  });

  it('round-trips the key to a partner’s device', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);

    const waiting = await founder.service.pendingDevices(COUPLE, ALICE);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.profileId).toBe(BOB);
    expect(waiting[0]!.isMine).toBe(false);

    expect(await founder.service.verifyAndWrap(COUPLE, ALICE, waiting[0]!)).toEqual({ ok: true });

    expect(await joiner.service.tryAdoptWrap(COUPLE, BOB)).toBe('ready');

    const mine = await founder.vault.readCoupleKey();
    const theirs = await joiner.vault.readCoupleKey();
    expect(bytesEqual(mine!.root, theirs!.root)).toBe(true);
    expect(theirs!.epoch).toBe(0);
  });

  it('shows both devices the same safety number', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    const { keypair: joinerKeypair } = await joiner.service.ensureDeviceKey(BOB);

    const waiting = await founder.service.pendingDevices(COUPLE, ALICE);
    const founderKey = db.devices.find((row) => row.profileId === ALICE)!;

    // The waiting device computes it from the other direction: its own key
    // plus the one the database served it. Sorting inside `safetyNumber` is
    // what makes the two agree without either trusting an order.
    expect(waiting[0]!.safetyNumber).toBe(
      safetyNumber(joinerKeypair.publicKey, fromBase64(founderKey.publicKey), COUPLE),
    );
  });

  it('lets you approve your own second install', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    // The second app on the same phone: same person, different bundle, so a
    // different keychain and a device with no key. If this could not be
    // approved, installing the second app would be a dead end.
    const secondApp = device(db.repository, 3);
    await secondApp.service.ensureDeviceKey(ALICE);

    const waiting = await founder.service.pendingDevices(COUPLE, ALICE);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.isMine).toBe(true);

    expect(await founder.service.verifyAndWrap(COUPLE, ALICE, waiting[0]!)).toEqual({ ok: true });
    expect(await secondApp.service.tryAdoptWrap(COUPLE, ALICE)).toBe('ready');
  });

  it('will not open a wrap addressed to someone else', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);
    const waiting = await founder.service.pendingDevices(COUPLE, ALICE);
    await founder.service.verifyAndWrap(COUPLE, ALICE, waiting[0]!);
    const forBob = db.wraps.find((wrap) => wrap.deviceKeyId === waiting[0]!.deviceKeyId)!;

    // A third device of Bob's, and the hostile move: whoever runs the database
    // re-addresses Bob's wrap to it, so the row now names a device key it does
    // hold. Everything a filter could check is satisfied — only the tag is not,
    // because the wrapping key came from Alice's secret and *Bob's* public.
    const eavesdropper = device(db.repository, 4);
    const { deviceKeyId } = await eavesdropper.service.ensureDeviceKey(BOB);
    db.wraps.push({ ...forBob, deviceKeyId });

    expect(await eavesdropper.service.tryAdoptWrap(COUPLE, BOB)).toBe('absent');
    expect(await eavesdropper.vault.readCoupleKey()).toBeNull();
    expect(eavesdropper.keyStore.status()).toBe('absent');
  });

  it('finds the sending device even though the wrap names only a person', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    // Alice has two devices; the wrap records `wrapped_by = Alice`, not which
    // of them. The reader tries each and lets the tag decide.
    const alicePhone2 = device(db.repository, 5);
    await alicePhone2.service.ensureDeviceKey(ALICE);
    const own = await founder.service.pendingDevices(COUPLE, ALICE);
    await founder.service.verifyAndWrap(COUPLE, ALICE, own[0]!);
    await alicePhone2.service.tryAdoptWrap(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);
    const waiting = await alicePhone2.service.pendingDevices(COUPLE, ALICE);
    expect(waiting.map((entry) => entry.profileId)).toEqual([BOB]);
    await alicePhone2.service.verifyAndWrap(COUPLE, ALICE, waiting[0]!);

    expect(await joiner.service.tryAdoptWrap(COUPLE, BOB)).toBe('ready');
  });

  it('refuses to wrap to a public key that moved after it was compared', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);
    const waiting = await founder.service.pendingDevices(COUPLE, ALICE);

    // The row changes under the screen between the reading-aloud and the tap.
    const substituted = generateDeviceKeypair(counterRandom(99));
    db.devices.find((row) => row.id === waiting[0]!.deviceKeyId)!.publicKey = toBase64(
      substituted.publicKey,
    );

    expect(await founder.service.verifyAndWrap(COUPLE, ALICE, waiting[0]!)).toEqual({
      ok: false,
      reason: 'key_changed',
    });
    expect(db.wraps.filter((wrap) => wrap.deviceKeyId === waiting[0]!.deviceKeyId)).toEqual([]);
  });

  it('reports a device that vanished rather than wrapping to nothing', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);
    const waiting = await founder.service.pendingDevices(COUPLE, ALICE);

    db.devices.splice(
      db.devices.findIndex((row) => row.id === waiting[0]!.deviceKeyId),
      1,
    );

    expect(await founder.service.verifyAndWrap(COUPLE, ALICE, waiting[0]!)).toEqual({
      ok: false,
      reason: 'gone',
    });
  });

  it('adopts the key it already holds on a cold start', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);
    const relaunched = createCoupleKeyStore();
    const sameKeychain = createKeyService({
      keys: db.repository,
      vault: founder.vault,
      keyStore: relaunched,
      random: counterRandom(1),
    });

    expect(await sameKeychain.adoptStoredKey(COUPLE)).toBe('ready');
    expect(relaunched.status()).toBe('ready');
  });

  it('throws away a key held against a different couple', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    // Someone else signing in on this phone, or a couple left and rejoined.
    // Keeping the key would hand `deriveContentKey` the wrong salt.
    expect(await founder.service.adoptStoredKey(OTHER_COUPLE)).toBe('absent');
    expect(await founder.vault.readCoupleKey()).toBeNull();
    expect(founder.keyStore.status()).toBe('absent');
  });

  it('keeps the device identity when it forgets the couple key', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);
    const before = await founder.vault.readDeviceKey();

    await founder.service.forget();

    expect(founder.keyStore.status()).toBe('absent');
    expect(await founder.vault.readCoupleKey()).toBeNull();
    // Forgetting the identity too would orphan the `device_keys` row the
    // partner has already approved and make the next launch look like a new
    // device asking to be let in again.
    const after = await founder.vault.readDeviceKey();
    expect(bytesEqual(before!.secretKey, after!.secretKey)).toBe(true);
  });

  it('publishes one device row however many times it is called', async () => {
    const first = await founder.service.ensureDeviceKey(ALICE);
    const second = await founder.service.ensureDeviceKey(ALICE);

    expect(second.deviceKeyId).toBe(first.deviceKeyId);
    expect(db.devices).toHaveLength(1);
  });

  it('gives the approver a different number to compare after a reset', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);
    const before = (await founder.service.pendingDevices(COUPLE, ALICE))[0]!;

    await joiner.service.resetDeviceKey(BOB);
    const after = (await founder.service.pendingDevices(COUPLE, ALICE))[0]!;

    // The point of the whole mismatch path. Republishing would have produced
    // the same twelve characters — the number is a function of the keypair —
    // so a couple who cannot get the numbers to agree would have had no second
    // thing to try.
    expect(after.safetyNumber).not.toBe(before.safetyNumber);
    expect(after.deviceKeyId).not.toBe(before.deviceKeyId);

    // And exactly one row, not two. A leftover row is a number the partner may
    // be reading aloud that no device holds the secret for.
    expect(db.devices.filter((row) => row.profileId === BOB)).toHaveLength(1);
  });

  it('takes any wrap made to the identity it discarded', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);
    const waiting = (await founder.service.pendingDevices(COUPLE, ALICE))[0]!;
    await founder.service.verifyAndWrap(COUPLE, ALICE, waiting);

    await joiner.service.resetDeviceKey(BOB);

    // The cascade is the database's (`tests/rls/policies.test.ts` asserts it
    // against the real schema); what matters here is the consequence. The old
    // wrap named a keypair this device no longer has, so keeping it would have
    // left a row nobody could ever open, and left the joiner looking approved
    // when it is not.
    expect(db.wraps.filter((wrap) => wrap.deviceKeyId === waiting.deviceKeyId)).toEqual([]);
    expect(await joiner.service.tryAdoptWrap(COUPLE, BOB)).toBe('absent');
    expect(joiner.keyStore.status()).toBe('absent');
  });

  it('still lets the partner in on the second try', async () => {
    await founder.service.createCoupleKey(COUPLE, ALICE);

    const joiner = device(db.repository, 2);
    await joiner.service.ensureDeviceKey(BOB);
    await joiner.service.resetDeviceKey(BOB);

    // A reset is a retry, not an exit: the numbers are compared again against
    // the new identity and the flow continues where it was.
    const theirs = await joiner.service.visibleDevices(COUPLE, BOB);
    const ours = await founder.service.pendingDevices(COUPLE, ALICE);
    expect(ours).toHaveLength(1);
    expect(theirs[0]!.safetyNumber).toBe(ours[0]!.safetyNumber);

    expect(await founder.service.verifyAndWrap(COUPLE, ALICE, ours[0]!)).toEqual({ ok: true });
    expect(await joiner.service.tryAdoptWrap(COUPLE, BOB)).toBe('ready');
  });
});
