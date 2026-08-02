/**
 * The keychain implementation of `CoupleKeyVault`.
 *
 * Two items with two different accessibility levels, and the difference is the
 * whole design of this file:
 *
 *   * **The device secret** is this installation's identity. It is
 *     `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so it is excluded from backups and from
 *     iCloud Keychain. That is deliberate and slightly counter-intuitive — a
 *     restorable device identity would mean two phones answering to one
 *     `device_keys` row, a safety number that no longer identifies a device,
 *     and one revocation killing both.
 *
 *   * **The couple key** is the data. It is `AFTER_FIRST_UNLOCK`, *not*
 *     `THIS_DEVICE_ONLY`, so it rides an encrypted backup to a new phone and a
 *     routine upgrade does not need the partner awake to re-approve. The trade
 *     is worth stating plainly: this puts the key inside whatever protects the
 *     user's device backup, so "the server alone cannot read it" also means
 *     "the server plus the backup provider cannot read it, separately".
 *
 * Neither uses `requireAuthentication: true`, and that is not an oversight.
 * `expo-secure-store`'s own typings say such keys are invalidated when
 * biometrics change — enrolling a new fingerprint would make every row on the
 * device permanently unreadable — and that the flag "would not work in tandem
 * with the `keychainService` value used for the other non-authenticated
 * operations". A lock screen belongs at the app layer, where `AppLockGate`
 * already puts it, not in front of the only copy of the key.
 */
import {
  DEVICE_SECRET_KEY_BYTES,
  fromBase64,
  publicKeyFor,
  ROOT_KEY_BYTES,
  toBase64,
  type CoupleKeyVault,
  type CoupleRootKey,
  type DeviceKeypair,
  type StoredCoupleKey,
} from '@couple/crypto';
import * as SecureStore from 'expo-secure-store';

import { createChunkedStore } from './secure-storage';

const DEVICE_KEY = 'couple.device_secret';
const COUPLE_KEY = 'couple.root_key';

/**
 * Only the secret is stored; the public key is recomputed from it on read.
 *
 * Storing both would create a pair that can disagree, and a device whose stored
 * public key does not match its secret publishes a `device_keys` row nobody can
 * ever wrap to.
 */
const deviceStore = createChunkedStore({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

const coupleStore = createChunkedStore({
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
});

interface StoredCoupleKeyJson {
  root: string;
  coupleId: string;
  epoch: number;
}

function isStoredCoupleKeyJson(value: unknown): value is StoredCoupleKeyJson {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.root === 'string' &&
    typeof candidate.coupleId === 'string' &&
    candidate.coupleId !== '' &&
    typeof candidate.epoch === 'number' &&
    Number.isInteger(candidate.epoch) &&
    candidate.epoch >= 0
  );
}

export function createKeyVault(): CoupleKeyVault {
  return {
    async readDeviceKey(): Promise<DeviceKeypair | null> {
      const raw = await deviceStore.getItem(DEVICE_KEY);
      if (raw === null) return null;

      // A value that will not decode is a value that cannot be used, and
      // throwing here would be a launch crash with no way out of it. Dropping it
      // costs one re-approval; keeping it costs the app.
      try {
        const secretKey = fromBase64(raw);
        if (secretKey.length !== DEVICE_SECRET_KEY_BYTES) throw new Error('wrong length');
        return { secretKey, publicKey: publicKeyFor(secretKey) };
      } catch {
        await deviceStore.removeItem(DEVICE_KEY);
        return null;
      }
    },

    async writeDeviceKey(keypair: DeviceKeypair): Promise<void> {
      await deviceStore.setItem(DEVICE_KEY, toBase64(keypair.secretKey));
    },

    async readCoupleKey(): Promise<StoredCoupleKey | null> {
      const raw = await coupleStore.getItem(COUPLE_KEY);
      if (raw === null) return null;

      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isStoredCoupleKeyJson(parsed)) throw new Error('unrecognised shape');
        const root = fromBase64(parsed.root);
        if (root.length !== ROOT_KEY_BYTES) throw new Error('wrong length');
        return { root: root as CoupleRootKey, coupleId: parsed.coupleId, epoch: parsed.epoch };
      } catch {
        await coupleStore.removeItem(COUPLE_KEY);
        return null;
      }
    },

    async writeCoupleKey(entry: StoredCoupleKey): Promise<void> {
      const json: StoredCoupleKeyJson = {
        root: toBase64(entry.root),
        coupleId: entry.coupleId,
        epoch: entry.epoch,
      };
      await coupleStore.setItem(COUPLE_KEY, JSON.stringify(json));
    },

    async clearCoupleKey(): Promise<void> {
      await coupleStore.removeItem(COUPLE_KEY);
    },
  };
}
