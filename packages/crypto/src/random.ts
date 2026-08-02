/**
 * Where random bytes come from.
 *
 * Injected rather than imported, exactly as `AuthStorage` is injected into
 * `createSupabaseClient`: this package must run unchanged under Hermes, where
 * there is no `globalThis.crypto`, and under plain Node in the test suites.
 * Reaching for an ambient global would work in one and fail in the other.
 *
 * The apps pass `expo-crypto`'s `getRandomBytes` through
 * `packages/device/src/random.ts`; the tests pass `node:crypto`. Nothing in
 * `@noble/*` that touches a global is used here — every nonce and every key is
 * generated through this type, never through a library convenience helper.
 */
export type RandomSource = (byteLength: number) => Uint8Array;

/**
 * Draw bytes, and check the source actually produced them.
 *
 * A `RandomSource` that returns a short buffer would silently weaken every key
 * derived from it, with no symptom until someone audits the entropy. Cheap to
 * refuse here instead.
 */
export function randomBytes(random: RandomSource, byteLength: number): Uint8Array {
  const bytes = random(byteLength);

  if (!(bytes instanceof Uint8Array)) {
    throw new Error('RandomSource did not return a Uint8Array');
  }
  if (bytes.length !== byteLength) {
    throw new Error(`RandomSource returned ${bytes.length} bytes, expected ${byteLength}`);
  }

  return bytes;
}
