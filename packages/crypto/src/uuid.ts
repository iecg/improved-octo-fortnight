/**
 * Row ids, minted on the device.
 *
 * A payload's AAD binds to the id of the row it belongs to, which means the id
 * has to exist before the payload is sealed — so `gen_random_uuid()` on the
 * server is too late for the tables keyed that way. The client mints one and
 * sends it with the insert.
 *
 * Version 4, from the same injected `RandomSource` as every other secret here,
 * because there is no `crypto.randomUUID` on Hermes either.
 */
import { randomBytes, type RandomSource } from './random';

export function randomUuid(random: RandomSource): string {
  const bytes = randomBytes(random, 16);

  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
