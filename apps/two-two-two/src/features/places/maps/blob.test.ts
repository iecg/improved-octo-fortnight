/**
 * The map thumbnail's decode step.
 *
 * This exists because the first version of it could not work. `btoa` is a Web
 * API that Hermes does not implement and neither React Native nor Expo
 * polyfills, and React Native's `Blob` has no `arrayBuffer()` — so the original
 * threw on the first line and the caller's `try`/`catch` turned that into "the
 * map never appears", silently, on a device nobody was watching. A unit suite
 * running under Node would not have caught it either, because Node has both.
 *
 * So the assertion that matters here is the negative one: this must not reach
 * for anything the app's actual runtime lacks.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { blobToDataUri } from './blob';

/** Stands in for React Native's globally-polyfilled FileReader. */
class FakeReader {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  result: unknown = null;
  static behaviour: 'load' | 'error' | 'throw' = 'load';
  static value: unknown = 'data:image/png;base64,AAAA';

  readAsDataURL(_blob: Blob): void {
    if (FakeReader.behaviour === 'throw') throw new Error('nope');
    queueMicrotask(() => {
      if (FakeReader.behaviour === 'error') return this.onerror?.();
      this.result = FakeReader.value;
      this.onload?.();
    });
  }
}

function withReader<T>(reader: unknown, run: () => T): T {
  const globals = globalThis as { FileReader?: unknown };
  const original = globals.FileReader;
  globals.FileReader = reader;
  try {
    return run();
  } finally {
    globals.FileReader = original;
  }
}

const blob = { size: 1, type: 'image/png' } as unknown as Blob;

describe('blobToDataUri', () => {
  it('returns what the reader decoded', async () => {
    FakeReader.behaviour = 'load';
    FakeReader.value = 'data:image/png;base64,AAAA';

    const result = await withReader(FakeReader, () => blobToDataUri(blob));
    expect(result).toBe('data:image/png;base64,AAAA');
  });

  it('hands the blob straight to readAsDataURL', async () => {
    // Never through JavaScript: the bytes stay native, which is the whole
    // reason this is FileReader and not a manual base64 loop.
    const spy = vi.fn();
    class Spying extends FakeReader {
      override readAsDataURL(b: Blob) {
        spy(b);
        super.readAsDataURL(b);
      }
    }
    FakeReader.behaviour = 'load';

    await withReader(Spying, () => blobToDataUri(blob));
    expect(spy).toHaveBeenCalledWith(blob);
  });

  it.each([
    ['the reader errors', 'error' as const],
    ['the reader throws synchronously', 'throw' as const],
  ])('resolves to null when %s', async (_name, behaviour) => {
    FakeReader.behaviour = behaviour;
    await expect(withReader(FakeReader, () => blobToDataUri(blob))).resolves.toBeNull();
  });

  it('resolves to null when the result is not a string', async () => {
    FakeReader.behaviour = 'load';
    FakeReader.value = new ArrayBuffer(4);
    await expect(withReader(FakeReader, () => blobToDataUri(blob))).resolves.toBeNull();
  });

  it('resolves to null rather than throwing when there is no FileReader at all', async () => {
    await expect(withReader(undefined, () => blobToDataUri(blob))).resolves.toBeNull();
  });

  /**
   * The regression guard. Node has `btoa` and `Blob.arrayBuffer`; the app's
   * runtime has neither, so no behavioural test here can catch their return.
   * Reading the source is the only check that works from Node.
   */
  it('never reaches for an API the app’s runtime does not have', () => {
    const source = readFileSync(new URL('./blob.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/\bbtoa\b/);
    expect(code).not.toMatch(/\barrayBuffer\b/);
  });
});
