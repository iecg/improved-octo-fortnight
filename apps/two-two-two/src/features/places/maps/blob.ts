/**
 * Image bytes to something `<Image source={{ uri }} />` will accept.
 *
 * This is `FileReader` rather than the obvious `btoa(String.fromCharCode(...))`
 * for two reasons, both of which fail at runtime rather than at build time:
 *
 *  - **`btoa` does not exist here.** It is a Web API, not a JavaScript one.
 *    Hermes does not provide it, and neither React Native nor Expo polyfills
 *    it — so calling it throws `ReferenceError`. Inside the caller's
 *    `try`/`catch` that becomes "the map never appears", with nothing logged.
 *  - **React Native's `Blob` has no `arrayBuffer()`.** It is a handle to bytes
 *    held natively, not an in-memory buffer, and its JS surface is `size`,
 *    `type` and `slice`.
 *
 * `FileReader` *is* polyfilled globally by React Native
 * (`Libraries/Core/setUpXHR.js`) and its `readAsDataURL` is implemented
 * natively, which makes it both the correct API and the one that never brings
 * the bytes through JavaScript at all.
 *
 * Reads the reader off `globalThis` rather than importing it, so the absence
 * of the polyfill is a null return here rather than a module that cannot load —
 * and so a test can supply its own.
 */

type DataUriReader = {
  readAsDataURL(blob: Blob): void;
  onload: null | (() => void);
  onerror: null | (() => void);
  result: unknown;
};

export async function blobToDataUri(blob: Blob): Promise<string | null> {
  const Reader = (globalThis as { FileReader?: new () => DataUriReader }).FileReader;
  if (!Reader) return null;

  return new Promise<string | null>((resolve) => {
    const reader = new Reader();
    // Never rejects. A map that will not decode is a missing map, which every
    // caller already renders as nothing.
    reader.onerror = () => resolve(null);
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    try {
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}
