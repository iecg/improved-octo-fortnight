import { describe, expect, it } from 'vitest';

import {
  DISPLAY_NAME_MAX,
  displayNameLength,
  isDisplayNameValid,
  normalizeDisplayName,
} from './name';

/**
 * The one rule encryption took away from the database.
 *
 * `profiles.display_name` used to carry a `CHECK` on its length; the column now
 * holds ciphertext, so nothing on the server can measure the name inside it.
 * These are what replaced it.
 */

describe('normalizeDisplayName', () => {
  it('trims, because a trailing space is not a name', () => {
    expect(normalizeDisplayName('  Ana  ')).toBe('Ana');
  });

  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['a tab and a newline', '\t\n'],
    ['already absent', null],
  ])('treats %s as no name at all', (_label, raw) => {
    // Null rather than the empty string: an empty payload would be a sealed
    // nothing, which a partner's screen cannot tell apart from a name that
    // failed to open.
    expect(normalizeDisplayName(raw)).toBeNull();
  });

  it('leaves the inside of a name alone', () => {
    // Two given names, a hyphen, an accent. Nothing here is this function's
    // business to tidy.
    expect(normalizeDisplayName('  María-José  del Río ')).toBe('María-José  del Río');
  });
});

describe('displayNameLength', () => {
  it('counts what the person typed, not UTF-16 units', () => {
    // `'😀'.length` is 2. Someone who typed one character being told they used
    // two is the kind of small lie that makes a limit feel arbitrary.
    expect('😀'.length).toBe(2);
    expect(displayNameLength('😀')).toBe(1);
  });

  it('handles a name that is entirely outside the BMP', () => {
    expect(displayNameLength('😀'.repeat(DISPLAY_NAME_MAX))).toBe(DISPLAY_NAME_MAX);
  });
});

describe('isDisplayNameValid', () => {
  it('admits a name at exactly the limit', () => {
    expect(isDisplayNameValid('a'.repeat(DISPLAY_NAME_MAX))).toBe(true);
    expect(isDisplayNameValid('😀'.repeat(DISPLAY_NAME_MAX))).toBe(true);
  });

  it('refuses one character more', () => {
    expect(isDisplayNameValid('a'.repeat(DISPLAY_NAME_MAX + 1))).toBe(false);
    expect(isDisplayNameValid('😀'.repeat(DISPLAY_NAME_MAX + 1))).toBe(false);
  });

  it('admits no name', () => {
    expect(isDisplayNameValid(null)).toBe(true);
  });
});
