/**
 * What a display name is allowed to be.
 *
 * The rule used to be a `CHECK` on `profiles.display_name`. Encryption moved it
 * here, because the column the server now sees holds ciphertext and a database
 * cannot measure a string it cannot read — `profiles_name_payload_bounded` is a
 * ceiling on the blob, not a measurement of the name inside it. Worth being
 * plain that this is an integrity check moved off the server; the only party it
 * ever protected against was the couple themselves, since RLS already confines
 * writes to their own rows.
 *
 * It lives in `packages/core` rather than beside the seal because two callers
 * need the same answer: the repository, which must not seal something over the
 * limit, and the screen, which has to say so before the person taps save. A
 * rule enforced in one place and guessed at in the other is how the two drift.
 */

/**
 * Counted in code points, not UTF-16 units.
 *
 * `'😀'.length` is 2, and a person who typed one character would be told they
 * had used two. Grapheme clusters would be more correct still — a flag emoji is
 * several code points — but `Intl.Segmenter` is not something to rely on across
 * Hermes versions for a limit whose only job is to stop a name being a novel.
 */
export const DISPLAY_NAME_MAX = 80;

export class DisplayNameTooLongError extends Error {
  constructor(length: number) {
    super(`a display name may be at most ${DISPLAY_NAME_MAX} characters; got ${length}`);
  }
}

/** Code points, so an emoji counts as the one character it looks like. */
export function displayNameLength(name: string): number {
  return Array.from(name).length;
}

/**
 * Trim, and treat whitespace-only as no name at all.
 *
 * `null` rather than `''` because that is what the schema stores: an empty
 * `name_payload` would be a sealed empty string, which is a payload that exists
 * and says nothing — indistinguishable to a partner from a name that failed to
 * decrypt.
 */
export function normalizeDisplayName(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** Whether `normalizeDisplayName`'s output is short enough to seal. */
export function isDisplayNameValid(name: string | null): boolean {
  return name === null || displayNameLength(name) <= DISPLAY_NAME_MAX;
}
