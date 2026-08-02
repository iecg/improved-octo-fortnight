/**
 * Where a device parks its keys between launches — as a port, not an
 * implementation.
 *
 * The same decision as `RandomSource`, for the same reason: the only honest
 * implementation is a keychain, and a keychain is a native module. Declaring
 * the shape here rather than in `packages/device` is what lets `packages/auth`
 * orchestrate key arrival without importing a native module — which would put
 * one behind every `@couple/auth` import, including in tests.
 *
 * Types only. There is nothing to run in this file, which is also why it does
 * not disturb the purity assertion in `tests/guards/no-plaintext-content.test.ts`.
 */
import type { CoupleRootKey, DeviceKeypair } from './keys';

/**
 * The couple key as it sits at rest, with what is needed to know whether it is
 * still the right one.
 *
 * `coupleId` is stored beside the key rather than inferred, because it is the
 * salt `deriveContentKey` uses. A key adopted against the wrong couple id would
 * not fail loudly — it would derive a plausible content key that opens nothing.
 */
export interface StoredCoupleKey {
  root: CoupleRootKey;
  coupleId: string;
  epoch: number;
}

export interface CoupleKeyVault {
  /** This device's long-term identity. Null until `ensureDeviceKey` mints one. */
  readDeviceKey(): Promise<DeviceKeypair | null>;
  writeDeviceKey(keypair: DeviceKeypair): Promise<void>;

  readCoupleKey(): Promise<StoredCoupleKey | null>;
  writeCoupleKey(entry: StoredCoupleKey): Promise<void>;

  /**
   * Drop the couple key, keeping the device identity.
   *
   * Two different lifetimes, deliberately: the couple key is what a stale or
   * rotated pairing invalidates, while the device keypair is this installation's
   * name. Forgetting the name too would orphan the `device_keys` row that the
   * partner has already approved and make the next launch look like a new
   * device.
   */
  clearCoupleKey(): Promise<void>;
}
