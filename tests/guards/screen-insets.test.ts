/**
 * A screen inside the tab navigator must not claim the bottom safe-area inset.
 *
 * React Navigation lays the scene container and the tab bar as siblings in a
 * column flex, and `getTabBarHeight` returns `TABBAR_HEIGHT_UIKIT + inset` — so
 * the tab bar has already spent the bottom inset and the scene already ends
 * above the home indicator. Nothing hands the scene a reduced inset either:
 * `BottomTabView` gives them to the tab bar alone, and only `StackView`
 * re-provides them. So a tab screen that also claims `'bottom'` spends it
 * twice, and the scene container's `overflow: 'hidden'` clips its content into
 * the ~34pt strip that results instead of letting it scroll.
 *
 * That is what `<Screen tabbed>` is for, and it is exactly the kind of rule
 * that gets forgotten on the eighth tab screen: the mistake costs nothing at
 * write time, typechecks, passes every unit test, and shows up only as a dead
 * band above the tab bar on a device. This is the grep that notices.
 *
 * The rule is positional rather than semantic — a file under `app/(tabs)/` is a
 * tab screen and a file outside it is not — which is precisely why it can be
 * checked here. Routes outside `(tabs)` (`plan/new`, `pair`, `unlock`) render
 * full height with no tab bar under them and must keep the default.
 *
 * One thing this deliberately cannot see: the shared screens in
 * `packages/auth/src/screens.tsx`, which render `<Screen>` themselves and are
 * mounted by `pair.tsx` and `sign-in.tsx`. They are never tab screens, so the
 * default is right for them, but they are outside `apps/*\/app/` and a walk
 * over routes will not reach them. If a shared package ever renders a screen
 * that *is* mounted in the tabs, this guard will not notice.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IGNORED_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'ios', 'android']);

/** `<Screen`, `<Screen>`, `<Screen tabbed>`, `<Screen\n  tabbed` — any of them. */
const RENDERS_SCREEN = /<Screen[\s/>]/;
const TABBED = /<Screen\b[^>]*\btabbed\b/;

function tsxFilesIn(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFilesIn(full, found);
    else if (extname(entry) === '.tsx') found.push(full);
  }
  return found;
}

/** Every `.tsx` under any app's `app/` route directory. */
function routeFiles(): string[] {
  const apps = join(REPO_ROOT, 'apps');
  return readdirSync(apps)
    .map((app) => join(apps, app, 'app'))
    .filter((dir) => statSync(dir).isDirectory())
    .flatMap((dir) => tsxFilesIn(dir));
}

/** Inside the tab navigator's route group, at any depth below it. */
function isTabRoute(file: string): boolean {
  return relative(REPO_ROOT, file).split(sep).includes('(tabs)');
}

describe('screen safe-area insets', () => {
  /**
   * Both halves have to be non-empty. If the route walk or the `<Screen` match
   * quietly stopped working — routes move, the component gets renamed — every
   * assertion below would pass over nothing and prove nothing.
   */
  it('finds tab routes and non-tab routes to check', () => {
    const routes = routeFiles().filter((file) => RENDERS_SCREEN.test(readFileSync(file, 'utf8')));
    expect(routes.filter(isTabRoute).length).toBeGreaterThan(0);
    expect(routes.filter((file) => !isTabRoute(file)).length).toBeGreaterThan(0);
  });

  it('marks every tab screen as tabbed', () => {
    const offenders = routeFiles()
      .filter(isTabRoute)
      .map((file) => ({ file, contents: readFileSync(file, 'utf8') }))
      .filter(({ contents }) => RENDERS_SCREEN.test(contents))
      .filter(({ contents }) => !TABBED.test(contents))
      .map(({ file }) => relative(REPO_ROOT, file));

    // Each of these renders a dead ~34pt band above the tab bar, with its own
    // content clipped into it.
    expect(offenders).toEqual([]);
  });

  /**
   * The other direction is a real bug too, and a less visible one: a screen
   * with no tab bar under it that declines the inset puts its last row under
   * the home indicator, where the system gesture area swallows taps.
   */
  it('leaves the inset to every screen that is not in the tabs', () => {
    const offenders = routeFiles()
      .filter((file) => !isTabRoute(file))
      .map((file) => ({ file, contents: readFileSync(file, 'utf8') }))
      .filter(({ contents }) => TABBED.test(contents))
      .map(({ file }) => relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
