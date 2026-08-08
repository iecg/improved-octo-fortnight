/**
 * Every app defines every colour `packages/ui` uses.
 *
 * The components in `packages/ui` are shared, but the palette they render
 * against is not — each app supplies its own values so the couple apps can stay
 * warm and a chores app can look like a utility. That split has one sharp edge:
 * Tailwind silently drops a class whose colour it cannot resolve. An app
 * missing `ontrack` renders `bg-ontrack` as no background at all. There is no
 * error, no warning, and no type failure — `CadenceBar` just quietly loses its
 * bar, and it looks like a layout bug rather than a missing token.
 *
 * So the names live in `packages/ui/tokens.js` as data and this asserts every
 * app honours them. Adding an app means adding it here; adding a token means
 * every app has to answer for it.
 */
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import resolveConfig from 'tailwindcss/resolveConfig';

const require = createRequire(import.meta.url);

const { TOKEN_NAMES } = require('../../packages/ui/tokens.js') as { TOKEN_NAMES: string[] };

const APPS_DIR = fileURLToPath(new URL('../../apps', import.meta.url));

/** Discovered rather than listed, so a new app cannot opt itself out by omission. */
function appNames(): string[] {
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

type Palette = Record<string, { DEFAULT?: string; dark?: string } | string>;

function paletteFor(app: string): Palette {
  const config = require(`${APPS_DIR}/${app}/tailwind.config.js`) as {
    theme?: { extend?: { colors?: Palette } };
  };
  return config.theme?.extend?.colors ?? {};
}

describe('tailwind colour tokens', () => {
  it('finds apps to check', () => {
    expect(appNames().length).toBeGreaterThan(0);
  });

  it('names at least the tokens the shared components use', () => {
    expect(TOKEN_NAMES).toContain('accent');
    expect(TOKEN_NAMES).toContain('canvas');
  });

  it.each(appNames())('%s defines every token, in both modes', (app) => {
    const palette = paletteFor(app);

    // Reported as whole lists rather than one failed assertion at a time: a new
    // app is missing all nine, and finding that out nine runs in a row is worse
    // than seeing it once.
    const missing = TOKEN_NAMES.filter((token) => !(token in palette));
    expect(missing).toEqual([]);

    const incomplete = TOKEN_NAMES.filter((token) => {
      const value = palette[token];
      return typeof value !== 'object' || !value?.DEFAULT || !value?.dark;
    });
    expect(incomplete).toEqual([]);
  });

  /**
   * The companion failure, and the one that actually bit during this refactor.
   *
   * Defining every colour is not enough if Tailwind never reads the files that
   * use them. `content` is the one key a preset cannot supply — an app's array
   * replaces the preset's instead of extending it — so the scan path into
   * `packages/ui` has to be repeated in every app, which makes it exactly the
   * kind of thing that gets dropped while tidying a config.
   */
  it.each(appNames())('%s scans packages/ui for class names', (app) => {
    const config = require(`${APPS_DIR}/${app}/tailwind.config.js`);
    const files: string[] = resolveConfig(config).content.files.map(String);

    expect(files.some((file) => file.includes('packages/ui'))).toBe(true);
  });
});
