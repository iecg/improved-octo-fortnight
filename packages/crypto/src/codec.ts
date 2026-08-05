/**
 * UTF-8 and base64, implemented rather than imported.
 *
 * Expo SDK 57's winter runtime installs `TextDecoder` but not `TextEncoder`,
 * and Hermes has no `btoa`/`atob` — `node_modules/expo/src/winter/runtime.native.ts`
 * is the list. So the two codecs every sealed payload passes through would be
 * present under Node and absent on device, and the difference would not surface
 * until a real build. That is the worst place to find it.
 *
 * They are also why this package can keep `"lib": ["ES2022"]` with no `"DOM"`:
 * nothing here reaches for an ambient global.
 *
 * Both decoders are strict. A decoder that quietly accepts overlong sequences,
 * encoded surrogates, or non-canonical padding is a decoder that disagrees with
 * the encoder that produced the bytes, and disagreement is the whole failure
 * mode this file exists to prevent.
 */

export class CodecError extends Error {}

// ------------------------------------------------------------------- utf-8

export function utf8ToBytes(text: string): Uint8Array {
  const out: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(index + 1);
      if (Number.isNaN(low) || low < 0xdc00 || low > 0xdfff) {
        throw new CodecError('unpaired high surrogate');
      }
      code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CodecError('unpaired low surrogate');
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return Uint8Array.from(out);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  let index = 0;

  while (index < bytes.length) {
    const lead = bytes[index]!;
    let code: number;
    let continuations: number;
    let smallest: number;

    if (lead < 0x80) {
      code = lead;
      continuations = 0;
      smallest = 0;
    } else if ((lead & 0xe0) === 0xc0) {
      code = lead & 0x1f;
      continuations = 1;
      smallest = 0x80;
    } else if ((lead & 0xf0) === 0xe0) {
      code = lead & 0x0f;
      continuations = 2;
      smallest = 0x800;
    } else if ((lead & 0xf8) === 0xf0) {
      code = lead & 0x07;
      continuations = 3;
      smallest = 0x10000;
    } else {
      throw new CodecError('invalid UTF-8 lead byte');
    }

    if (index + continuations >= bytes.length) throw new CodecError('truncated UTF-8 sequence');

    for (let step = 1; step <= continuations; step += 1) {
      const byte = bytes[index + step]!;
      if ((byte & 0xc0) !== 0x80) throw new CodecError('invalid UTF-8 continuation byte');
      code = (code << 6) | (byte & 0x3f);
    }

    if (code < smallest) throw new CodecError('overlong UTF-8 encoding');
    if (code > 0x10ffff) throw new CodecError('UTF-8 code point out of range');
    if (code >= 0xd800 && code <= 0xdfff) throw new CodecError('UTF-8 encoded a surrogate');

    if (code < 0x10000) {
      out += String.fromCharCode(code);
    } else {
      const shifted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff));
    }

    index += continuations + 1;
  }

  return out;
}

// ------------------------------------------------------------------ base64

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const DECODE: Record<string, number> = {};
for (let index = 0; index < ALPHABET.length; index += 1) DECODE[ALPHABET[index]!] = index;

/** Standard alphabet, correct padding, nothing trailing. */
const CANONICAL = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function toBase64(bytes: Uint8Array): string {
  let out = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];

    out += ALPHABET[first >> 2];
    out += ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    out += second === undefined ? '=' : ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    out += third === undefined ? '=' : ALPHABET[third & 0x3f];
  }

  return out;
}

export function fromBase64(text: string): Uint8Array {
  if (!CANONICAL.test(text)) throw new CodecError('not canonical base64');

  const body = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((body.length * 6) / 8));

  let accumulator = 0;
  let bits = 0;
  let offset = 0;

  for (let index = 0; index < body.length; index += 1) {
    accumulator = (accumulator << 6) | DECODE[body[index]!]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[offset] = (accumulator >> bits) & 0xff;
      offset += 1;
    }
  }

  // The leftover bits of the final symbol must be zero. Otherwise two distinct
  // strings decode to the same bytes, and a format CHECK on the column would be
  // asserting less than it appears to.
  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
    throw new CodecError('non-canonical base64 padding bits');
  }

  return out;
}

// ------------------------------------------------------------------ shared

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Length-independent comparison, for anything derived from a secret. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}
