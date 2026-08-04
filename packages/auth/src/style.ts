/**
 * The two classnames the auth screens need and `@couple/ui` does not provide.
 *
 * Package-private: `index.ts` re-exports `./screens` wholesale, so leaving
 * these in that file would have made them public API by accident. They are not
 * in `@couple/ui` because that package holds components, and neither of these
 * has a component's worth of behaviour — a `TextInput` primitive would have to
 * decide about labels, validation and keyboard types to be worth having, and
 * `Title`/`Body` cannot express `selectable`, which a code you are meant to
 * read aloud or copy needs.
 */

/** Matches the fields on the sign-in screen. */
export const INPUT_CLASS =
  'rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';

/**
 * A code meant to be read out: the invite code, and now the safety number.
 *
 * The tracking is the point — eight or twelve unbroken characters are hard to
 * read aloud accurately, and reading it aloud accurately is the entire security
 * property in the safety number's case.
 */
export const CODE_CLASS =
  'text-center text-3xl font-semibold tracking-[6px] text-ink dark:text-ink-dark';
