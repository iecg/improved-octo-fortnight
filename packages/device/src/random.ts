/**
 * The device's source of random bytes.
 *
 * `packages/crypto` takes randomness as an injected function so it can stay
 * free of native modules and run under plain Node in the test suites. This is
 * the app side of that contract, and it lives here because `packages/device` is
 * already the one place native modules are allowed.
 *
 * `expo-crypto` rather than `react-native-get-random-values`: the latter's
 * whole job is installing a `globalThis.crypto` polyfill, and whether it has
 * run yet depends on where it sits in Metro's module graph — the classic source
 * of a bug that only appears in a release build. This is a function you call.
 *
 * `getRandomBytes` is synchronous (checked against the installed `.d.ts`, per
 * the rule in CLAUDE.md about reading native APIs rather than recalling them),
 * which matters: the mappers that seal and open rows are synchronous, and an
 * async source would have made them contagious.
 */
import type { RandomSource } from '@couple/crypto';
import * as Crypto from 'expo-crypto';

export const deviceRandom: RandomSource = (byteLength) => Crypto.getRandomBytes(byteLength);
