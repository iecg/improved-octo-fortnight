/**
 * The 2-2-2 app's maps-optional rule, enforced rather than remembered.
 *
 * Three halves, and the third is the one that matters:
 *
 *  1. No path outside `features/<name>/maps/` or `supabase/functions/places/`
 *     may name a mapping provider. The app cannot know whether a key exists —
 *     it asks the proxy, which is the only thing that holds one.
 *
 *  2. No path ANYWHERE may put a provider key in an `EXPO_PUBLIC_` variable.
 *     Those are compiled into the shipped bundle and can be read back out of
 *     it, and unlike the Supabase anon key there is no RLS behind a mapping key
 *     — possession is the authorization. There is no exemption for this, not
 *     even inside the feature folder, because there is no correct place for it.
 *
 *  3. The no-provider path has to actually work. A grep that passes over a
 *     feature nobody can use proves nothing, which is the same reason the AI
 *     guard checks that the bundled idea library is non-empty.
 *
 * The rule is the 2-2-2 app's alone — the intimacy app has no places story —
 * which is why the whole repo is scanned rather than just that app.
 */
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { normalizeManualPlace, placeLabel, PLAN_LOCATION_MAX } from '../../apps/two-two-two/features/places/label';
import { mapsLinkFor } from '../../apps/two-two-two/features/places/link';
import { NO_CAPABILITIES } from '../../apps/two-two-two/features/places/maps/types';
import { isFeatureSegmentPath, REPO_ROOT, scannedFiles } from './sources';

/**
 * Anything that only makes sense when a mapping key is reachable. Reaching the
 * proxy counts: invoking it is itself the assumption that a key might exist.
 */
const PROVIDER_MARKERS = [
  /googleapis\.com/,
  /GOOGLE_MAPS_API_KEY/,
  /GOOGLE_PLACES_API_KEY/,
  /X-Goog-/,
  /functions\.invoke\(\s*['"`]places['"`]/,
];

/** Compiled into the bundle that ships to phones. No exemptions. */
const EMBEDDED_KEY_MARKER = /EXPO_PUBLIC_[A-Z0-9_]*(GOOGLE|MAPS|PLACES)/;

/** The server half — the only place a key may actually be read. */
function isPlacesFunctionPath(relativePath: string): boolean {
  return relativePath.startsWith(join('supabase', 'functions', 'places') + sep);
}

const files = scannedFiles();

describe('the maps-optional rule', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('keeps every provider reference inside features/*/maps/ or the places function', () => {
    const offenders = files
      .map((file) => relative(REPO_ROOT, file))
      .filter((path) => !isFeatureSegmentPath(path, 'maps') && !isPlacesFunctionPath(path))
      .filter((path) => {
        const contents = readFileSync(join(REPO_ROOT, path), 'utf8');
        return PROVIDER_MARKERS.some((marker) => marker.test(contents));
      });

    expect(offenders).toEqual([]);
  });

  it('never embeds a provider key in the app bundle', () => {
    const offenders = files
      .map((file) => relative(REPO_ROOT, file))
      .filter((path) => EMBEDDED_KEY_MARKER.test(readFileSync(join(REPO_ROOT, path), 'utf8')));

    expect(offenders).toEqual([]);
  });

  /**
   * The rule is only worth anything if the no-key path is useful.
   *
   * These are the modules a plan's place actually goes through when nothing is
   * configured — which is every install today. They live outside `maps/`, name
   * no provider, and are imported here directly: if they stopped working, the
   * greps above would still pass and the feature would still be broken.
   */
  it('attaches and shows a place with no provider involved', () => {
    expect(normalizeManualPlace('  Bar Nou,  Barcelona ')).toBe('Bar Nou, Barcelona');
    expect(normalizeManualPlace('   ')).toBeNull();

    const label = placeLabel('Café Anglès', 'Carrer dels Almogàvers 1');
    expect(label).toContain('Café Anglès');
    expect(label.length).toBeLessThanOrEqual(PLAN_LOCATION_MAX);
    // The column this reaches is capped, and a provider address can be long.
    expect(placeLabel('x'.repeat(150), 'y'.repeat(400)).length).toBeLessThanOrEqual(
      PLAN_LOCATION_MAX,
    );

    // "Open in Maps" is an OS URL scheme, so it needs no key and no network.
    for (const platform of ['ios', 'android'] as const) {
      expect(mapsLinkFor({ name: 'Bar Nou' }, platform)).toMatch(
        /^(https:\/\/maps\.apple\.com|geo:)/,
      );
    }
  });

  /**
   * All-false is the shape every screen must handle, so it is worth pinning
   * that the constant expressing it has not quietly grown a true.
   */
  it('treats a missing key as a complete, working state', () => {
    expect(Object.values(NO_CAPABILITIES).every((value) => value === false)).toBe(true);
  });
});
