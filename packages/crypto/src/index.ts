/**
 * Client-side encryption.
 *
 * Pure, in the same sense `packages/cadence` is pure: no React, no I/O, no
 * native modules, and no ambient globals. Randomness is injected as a function
 * and the codecs are implemented here rather than assumed, so the same code
 * runs under Hermes and under plain Node in the test suites.
 *
 * What this protects: the contents of a couple's rows, from whoever runs the
 * database. What it does not protect is written out in CLAUDE.md, and the first
 * item on that list is that shipping the app binary is still a position of
 * trust — end-to-end encryption makes the *server alone* unable to read the
 * data, not the developer permanently unable.
 */
export {
  bytesEqual,
  bytesToUtf8,
  CodecError,
  concatBytes,
  fromBase64,
  toBase64,
  utf8ToBytes,
} from './codec';

export {
  CipherError,
  createFieldCipher,
  identityString,
  MAX_PLAINTEXT_BYTES,
  openWithKey,
  PAYLOAD_VERSION,
  PayloadTooLargeError,
  sealWithKey,
  SUITE_XCHACHA20_POLY1305,
  type FieldCipher,
  type RecordIdentity,
} from './cipher';

export {
  CONTENT_KEY_BYTES,
  deriveContentKey,
  DEVICE_SECRET_KEY_BYTES,
  generateCoupleRootKey,
  generateDeviceKeypair,
  publicKeyFor,
  ROOT_KEY_BYTES,
  type ContentKey,
  type CoupleRootKey,
  type DeviceKeypair,
  type KeyScope,
} from './keys';

export type { CoupleKeyVault, StoredCoupleKey } from './vault';

export { randomBytes, type RandomSource } from './random';

export { createCoupleKeyStore, MissingCoupleKeyError, type CoupleKeyStore } from './store';

export {
  safetyNumber,
  unwrapCoupleKey,
  wrapCoupleKey,
  type UnwrapArgs,
  type WrapArgs,
} from './pairing';

export {
  generateRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_KDF,
  SCRYPT_PARAMS,
  unwrapWithRecoveryCode,
  wrapWithRecoveryCode,
  type RecoveryEnvelope,
  type ScryptParams,
} from './recovery';

export { unwrapWithKey, WRAP_VERSION, wrapWithKey } from './wrap';

export { randomUuid } from './uuid';
