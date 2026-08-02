/**
 * The codecs, checked against Node's own.
 *
 * These are the files most likely to be subtly wrong in a way no other test
 * would catch: they are hand-written precisely because the runtime on device
 * does not supply them, which also means the device is where a bug would first
 * show. `Buffer` is the oracle here — it is not available on Hermes, which is
 * the whole reason this module exists, but it is available here.
 */
import { describe, expect, it } from 'vitest';

import {
  bytesEqual,
  bytesToUtf8,
  CodecError,
  concatBytes,
  fromBase64,
  toBase64,
  utf8ToBytes,
} from './codec';

const SAMPLES = [
  '',
  'a',
  'ab',
  'abc',
  'abcd',
  'hello world',
  // The note the e2e journey actually writes, and the reason invariant 1 exists.
  'Reservamos mesa a las ocho — pide el postre, ¿vale?',
  'Ich möchte Crème brûlée',
  '日本語のテキスト',
  // Four-byte code points: emoji, and one with a skin-tone modifier.
  '🙈 tonight 🌙',
  '👩🏽‍🦰 family 👨‍👩‍👧‍👦',
  // Every byte a lone character can be.
  Array.from({ length: 128 }, (_, index) => String.fromCharCode(index)).join(''),
];

describe('utf-8', () => {
  it.each(SAMPLES)('round-trips %j byte-for-byte the way Node does', (sample) => {
    const ours = utf8ToBytes(sample);
    expect(Buffer.from(ours).equals(Buffer.from(sample, 'utf8'))).toBe(true);
    expect(bytesToUtf8(ours)).toBe(sample);
  });

  it('decodes what Node encodes', () => {
    for (const sample of SAMPLES) {
      expect(bytesToUtf8(new Uint8Array(Buffer.from(sample, 'utf8')))).toBe(sample);
    }
  });

  it('refuses a lone surrogate rather than emitting replacement bytes', () => {
    expect(() => utf8ToBytes('\ud800')).toThrow(CodecError);
    expect(() => utf8ToBytes('\udc00')).toThrow(CodecError);
    expect(() => utf8ToBytes('a\ud800b')).toThrow(CodecError);
  });

  /**
   * Each of these decodes to something plausible in a lenient decoder, and each
   * is a way for two implementations to disagree about what a payload said.
   */
  it.each([
    ['overlong two-byte NUL', [0xc0, 0x80]],
    ['overlong three-byte slash', [0xe0, 0x80, 0xaf]],
    ['encoded surrogate', [0xed, 0xa0, 0x80]],
    ['truncated sequence', [0xe2, 0x82]],
    ['bare continuation byte', [0x80]],
    ['invalid lead byte', [0xff]],
    ['missing continuation', [0xc3, 0x28]],
  ])('refuses %s', (_label, bytes) => {
    expect(() => bytesToUtf8(Uint8Array.from(bytes))).toThrow(CodecError);
  });
});

describe('base64', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 31, 32, 33, 64, 255])(
    'matches Node for %i bytes, covering every padding length',
    (length) => {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
      const encoded = toBase64(bytes);

      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect(Buffer.from(fromBase64(encoded)).equals(Buffer.from(bytes))).toBe(true);
    },
  );

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(Buffer.from(fromBase64(toBase64(all))).equals(Buffer.from(all))).toBe(true);
  });

  it.each([
    ['wrong length', 'AAAAA'],
    ['padding in the middle', 'AA=ABBBB'],
    ['too much padding', 'A==='],
    ['a character outside the alphabet', 'AA*A'],
    ['url-safe alphabet', 'ab-_'],
    ['trailing whitespace', 'AAAA '],
  ])('refuses %s', (_label, text) => {
    expect(() => fromBase64(text)).toThrow(CodecError);
  });

  /**
   * `AA==` and `AB==` decode to the same single byte in a lenient decoder. The
   * payload column carries a format CHECK, and a malleable encoding would make
   * that constraint assert less than it appears to.
   */
  it('refuses non-canonical padding bits', () => {
    expect(fromBase64('AA==')).toEqual(Uint8Array.of(0));
    expect(() => fromBase64('AB==')).toThrow(CodecError);
    expect(() => fromBase64('AAB=')).toThrow(CodecError);
  });
});

describe('helpers', () => {
  it('concatenates in order', () => {
    expect(concatBytes(Uint8Array.of(1, 2), Uint8Array.of(), Uint8Array.of(3))).toEqual(
      Uint8Array.of(1, 2, 3),
    );
  });

  it('compares bytes without leaking length through early return', () => {
    expect(bytesEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(bytesEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
  });
});
