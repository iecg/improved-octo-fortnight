/**
 * How the couple key reaches a device.
 *
 * Everything below is deliberately React-free: the only reason a screen exists
 * is to render what this decides, and keeping the decision here means it can be
 * tested against the real `@couple/crypto` in plain Node, with a fake
 * repository and an in-memory vault. Screens live in `key-screens.tsx`.
 *
 * The protocol, in one paragraph. Every install mints an X25519 keypair, keeps
 * the secret in the keychain and publishes the public half to `device_keys`. A
 * device that already holds the couple key can wrap it to any published public
 * key it can see — its partner's, or its own second install — and the two
 * people compare a twelve-character safety number first, which is what stops
 * the server substituting a key of its own. The wrap is opened by the recipient
 * and nobody else, including the server that stored it.
 */
import type {
  CoupleKeyStore,
  CoupleKeyVault,
  CoupleRootKey,
  DeviceKeypair,
  RandomSource,
} from '@couple/crypto';
import {
  fromBase64,
  generateCoupleRootKey,
  generateDeviceKeypair,
  safetyNumber,
  toBase64,
  unwrapCoupleKey,
  wrapCoupleKey,
} from '@couple/crypto';
import type { KeyRepository } from '@couple/data';

/** Whether this device can read the couple's rows. */
export type KeyState = 'ready' | 'absent';

/** The epoch a couple starts at. Rotation (stage 6) is what ever changes it. */
export const INITIAL_EPOCH = 0;

/**
 * A published device with no wrap yet — someone waiting to be let in.
 *
 * `isMine` is not a nicety. SecureStore is scoped per app bundle, so installing
 * the second app on the *same phone* produces a signed-in, paired, keyless
 * device belonging to you rather than to your partner. If only a partner's
 * device could be approved, that install could never be let in and CLAUDE.md's
 * "installing the second app finds the couple already connected" would stop
 * being true the moment encryption shipped. So approving your own device is the
 * default path, not a workaround — an iOS App Group would need entitlements in
 * both apps and has no Android equivalent, so it cannot be the general answer.
 */
export interface PendingDevice {
  deviceKeyId: string;
  profileId: string;
  publicKey: string;
  createdAt: string;
  isMine: boolean;
  /** What the two people read to each other. Identical on both devices. */
  safetyNumber: string;
}

export type WrapOutcome = { ok: true } | { ok: false; reason: 'key_changed' | 'gone' };

export interface KeyService {
  /** This device's identity, minted on first call and published every time. */
  ensureDeviceKey(profileId: string): Promise<{ keypair: DeviceKeypair; deviceKeyId: string }>;
  /**
   * Throw this device's identity away and mint another.
   *
   * What "the codes don't match" does, on the side that can do anything about
   * it. Merely republishing would change nothing — the safety number is a
   * function of the keypair, so the same keypair reads out the same twelve
   * characters however many times it is announced. A new keypair produces a
   * genuinely new number, which is what separates *we misread it* from
   * *something is sitting between these two phones*: after a rotation the
   * numbers should agree, and if they still do not, that is a signal rather
   * than a typo.
   *
   * Offer it only from a device with no key. One that holds the key would be
   * discarding its own self-wrap — the only evidence other devices have that it
   * holds anything — and would reappear as pending on its own second install.
   */
  resetDeviceKey(profileId: string): Promise<{ keypair: DeviceKeypair; deviceKeyId: string }>;
  /** Load the key this device already holds, if it is still the right one. */
  adoptStoredKey(coupleId: string): Promise<KeyState>;
  /** Mint the couple key. Exactly one device ever does this, at pairing. */
  createCoupleKey(coupleId: string, profileId: string): Promise<void>;
  /**
   * Every other device of this couple, each with the safety number to compare
   * against it. Needs no couple key, which is what lets the device that is
   * still waiting show the same twelve characters as the one approving it.
   */
  visibleDevices(coupleId: string, profileId: string): Promise<PendingDevice[]>;
  /** Those of the above with no wrap yet at the epoch this device holds. */
  pendingDevices(coupleId: string, profileId: string): Promise<PendingDevice[]>;
  verifyAndWrap(coupleId: string, profileId: string, device: PendingDevice): Promise<WrapOutcome>;
  /** Try to open a wrap addressed to this device. Idempotent; safe to poll. */
  tryAdoptWrap(coupleId: string, profileId: string): Promise<KeyState>;
  watchKeys(coupleId: string, onChange: () => void): () => void;
  /**
   * Drop the key from memory only.
   *
   * What signing out does. The keychain copy stays, so signing back in on your
   * own phone does not need another approval — but the key never outlives the
   * session that was holding it, so the next person to sign in on this device
   * cannot read the last one's rows even for the instant before `adoptStoredKey`
   * notices the couple is different.
   */
  lock(): void;
  /** Drop the key from memory *and* from the keychain. Keeps the device identity. */
  forget(): Promise<void>;
}

export function createKeyService(deps: {
  keys: KeyRepository;
  vault: CoupleKeyVault;
  keyStore: CoupleKeyStore;
  random: RandomSource;
}): KeyService {
  const { keys, vault, keyStore, random } = deps;

  async function loadDeviceKeypair(): Promise<DeviceKeypair> {
    const existing = await vault.readDeviceKey();
    if (existing) return existing;

    const minted = generateDeviceKeypair(random);
    await vault.writeDeviceKey(minted);
    return minted;
  }

  async function adopt(root: CoupleRootKey, coupleId: string, epoch: number): Promise<void> {
    await vault.writeCoupleKey({ root, coupleId, epoch });
    keyStore.set(root, coupleId, epoch);
  }

  /**
   * The key this device holds, read from the keychain rather than from the
   * in-memory store.
   *
   * `CoupleKeyStore` deliberately exposes derived content keys and not the
   * root, so wrapping — the one operation that legitimately needs the root
   * itself — goes to the vault. That keeps the store's narrow surface narrow
   * instead of widening it for a single caller.
   */
  async function heldKey(coupleId: string): Promise<{ root: CoupleRootKey; epoch: number } | null> {
    const stored = await vault.readCoupleKey();
    if (!stored || stored.coupleId !== coupleId) return null;
    return { root: stored.root, epoch: stored.epoch };
  }

  // Local functions rather than `this.…`, so that destructuring the service
  // keeps working — the same trap `createChunkedStore` fell into.
  async function ensureDeviceKey(
    profileId: string,
  ): Promise<{ keypair: DeviceKeypair; deviceKeyId: string }> {
    const keypair = await loadDeviceKeypair();
    const published = await keys.publishDeviceKey(profileId, toBase64(keypair.publicKey));
    return { keypair, deviceKeyId: published.id };
  }

  async function visibleDevices(coupleId: string, profileId: string): Promise<PendingDevice[]> {
    const keypair = await loadDeviceKeypair();
    const mine = toBase64(keypair.publicKey);
    const devices = await keys.listDeviceKeys();

    return devices
      .filter((device) => device.publicKey !== mine)
      .map((device) => ({
        deviceKeyId: device.id,
        profileId: device.profileId,
        publicKey: device.publicKey,
        createdAt: device.createdAt,
        isMine: device.profileId === profileId,
        // Computed from this device's own public key and what the database
        // served — the same two inputs the other device has, in the other
        // order. `safetyNumber` sorts them, so both sides read the same twelve
        // characters without exchanging anything more, and crucially without
        // either side needing the couple key to do it. That is what lets the
        // device still waiting to be let in display the number too.
        safetyNumber: safetyNumber(keypair.publicKey, fromBase64(device.publicKey), coupleId),
      }));
  }

  return {
    ensureDeviceKey,

    async resetDeviceKey(profileId) {
      const old = await vault.readDeviceKey();

      // Withdraw before minting, and the order is the interesting part. If this
      // is interrupted after the delete, the next `ensureDeviceKey` republishes
      // the key still sitting in the vault: the same number as before, which is
      // confusing but true. The other order can leave a published row that no
      // device holds the secret for — a phantom number nobody can answer for,
      // and one the partner may well be reading aloud.
      if (old) {
        const mine = toBase64(old.publicKey);
        const published = await keys.listDeviceKeys();
        for (const device of published) {
          if (device.profileId === profileId && device.publicKey === mine) {
            await keys.deleteDeviceKey(device.id);
          }
        }
      }

      await vault.writeDeviceKey(generateDeviceKeypair(random));
      return ensureDeviceKey(profileId);
    },

    async adoptStoredKey(coupleId) {
      const stored = await vault.readCoupleKey();
      if (!stored) return 'absent';

      // A key held against a different couple is not a key. Keeping it would
      // hand `deriveContentKey` the wrong salt and quietly derive a content key
      // that opens nothing — the failure would surface as unreadable rows far
      // from the cause. This is also what makes a second person signing in on
      // this phone safe.
      if (stored.coupleId !== coupleId) {
        await vault.clearCoupleKey();
        keyStore.clear();
        return 'absent';
      }

      keyStore.set(stored.root, stored.coupleId, stored.epoch);
      return 'ready';
    },

    async createCoupleKey(coupleId, profileId) {
      const root = generateCoupleRootKey(random);
      await adopt(root, coupleId, INITIAL_EPOCH);

      const { keypair, deviceKeyId } = await ensureDeviceKey(profileId);

      // The founding device wraps the key to itself, and this row is
      // load-bearing rather than ceremonial. A wrap is the only evidence *other*
      // devices can see that a device already holds the key — nothing else in
      // the schema says so, and nothing could, since holding it is a fact about
      // a keychain. Without this row the founder's own phone shows up as
      // "waiting to be let in" on the second app it installs.
      //
      // It is not a recovery mechanism: a reinstall mints a new device keypair,
      // so this wrap would be unopenable by the very device it names. What
      // survives a reinstall is the keychain copy, or a partner re-wrapping.
      await keys.putWrap({
        coupleId,
        deviceKeyId,
        epoch: INITIAL_EPOCH,
        wrappedKey: wrapCoupleKey({
          root,
          mySecret: keypair.secretKey,
          myPublic: keypair.publicKey,
          theirPublic: keypair.publicKey,
          coupleId,
          epoch: INITIAL_EPOCH,
          random,
        }),
        wrappedBy: profileId,
      });
    },

    visibleDevices,

    async pendingDevices(coupleId, profileId) {
      // Requires the key, because "pending" is relative to an epoch and the
      // epoch is a property of the key this device holds. A device with no key
      // has nobody to approve — it is the one waiting.
      const held = await heldKey(coupleId);
      if (!held) return [];

      const [visible, wraps] = await Promise.all([
        visibleDevices(coupleId, profileId),
        keys.listWraps(coupleId),
      ]);

      const wrapped = new Set(
        wraps.filter((wrap) => wrap.epoch === held.epoch).map((wrap) => wrap.deviceKeyId),
      );

      return visible.filter((device) => !wrapped.has(device.deviceKeyId));
    },

    async verifyAndWrap(coupleId, profileId, device) {
      const held = await heldKey(coupleId);
      if (!held) return { ok: false, reason: 'gone' };

      const keypair = await loadDeviceKeypair();

      // Re-read rather than trust the row the screen is holding. The safety
      // number the two people just compared is a statement about a specific
      // public key; if that key has changed since the screen rendered, the
      // comparison they made was about something else. This is what makes
      // "the number they checked is the number that got wrapped" true rather
      // than assumed.
      const current = (await keys.listDeviceKeys()).find(
        (candidate) => candidate.id === device.deviceKeyId,
      );
      if (!current) return { ok: false, reason: 'gone' };
      if (current.publicKey !== device.publicKey) return { ok: false, reason: 'key_changed' };

      await keys.putWrap({
        coupleId,
        deviceKeyId: current.id,
        epoch: held.epoch,
        wrappedKey: wrapCoupleKey({
          root: held.root,
          mySecret: keypair.secretKey,
          myPublic: keypair.publicKey,
          theirPublic: fromBase64(current.publicKey),
          coupleId,
          epoch: held.epoch,
          random,
        }),
        wrappedBy: profileId,
      });

      return { ok: true };
    },

    async tryAdoptWrap(coupleId, profileId) {
      const { keypair, deviceKeyId } = await ensureDeviceKey(profileId);
      const [devices, wraps] = await Promise.all([keys.listDeviceKeys(), keys.listWraps(coupleId)]);

      // Newest epoch first: after a rotation the old wrap is still sitting
      // there, and adopting it would leave this device holding a key that
      // opens nothing written since.
      const mine = wraps
        .filter((wrap) => wrap.deviceKeyId === deviceKeyId)
        .sort((a, b) => b.epoch - a.epoch);

      for (const wrap of mine) {
        // `wrapped_by` names a person, and a person may have several devices,
        // so the sender's public key has to be guessed at. Every visible key is
        // a candidate and the tag decides: the one that opens it is proof of
        // which device approved, which is a stronger statement than a column
        // recording which one claimed to.
        const candidates = devices.filter(
          (device) => wrap.wrappedBy === null || device.profileId === wrap.wrappedBy,
        );

        for (const candidate of candidates) {
          try {
            const root = unwrapCoupleKey({
              wrapped: wrap.wrappedKey,
              mySecret: keypair.secretKey,
              myPublic: keypair.publicKey,
              theirPublic: fromBase64(candidate.publicKey),
              coupleId,
              epoch: wrap.epoch,
            });
            await adopt(root, coupleId, wrap.epoch);
            return 'ready';
          } catch {
            // Wrong sender, or not for us. Indistinguishable on purpose —
            // saying which would be an oracle — so the only move is the next
            // candidate.
          }
        }
      }

      return 'absent';
    },

    watchKeys(coupleId, onChange) {
      return keys.watchKeys(coupleId, onChange);
    },

    lock() {
      keyStore.clear();
    },

    async forget() {
      keyStore.clear();
      await vault.clearCoupleKey();
    },
  };
}
