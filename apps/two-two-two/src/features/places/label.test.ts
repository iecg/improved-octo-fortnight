/**
 * The no-provider path, which is the one that has to be right.
 *
 * Everything here runs with nothing configured. If these break, the feature
 * does not degrade to "no search" — it degrades to a plan carrying a label the
 * database will reject or a calendar entry nobody can read.
 */
import { describe, expect, it } from 'vitest';

import { normalizeManualPlace, placeLabel, PLAN_LOCATION_MAX } from './label';
import { mapsLinkFor } from './link';

describe('normalizeManualPlace', () => {
  it('trims and collapses what a soft keyboard leaves behind', () => {
    expect(normalizeManualPlace('  Bar   Nou,  Barcelona  ')).toBe('Bar Nou, Barcelona');
  });

  it('treats whitespace-only input as no place at all', () => {
    expect(normalizeManualPlace('   ')).toBeNull();
    expect(normalizeManualPlace('')).toBeNull();
    expect(normalizeManualPlace('\n\t ')).toBeNull();
  });

  it('leaves accents and non-Latin text exactly as written', () => {
    // Partner-authored text is shown verbatim; normalizing it is not our call.
    expect(normalizeManualPlace('Café Anglès')).toBe('Café Anglès');
    expect(normalizeManualPlace('居酒屋')).toBe('居酒屋');
  });
});

describe('placeLabel', () => {
  it('joins a name and an address', () => {
    expect(placeLabel('Bar Nou', 'Carrer dels Almogàvers 1')).toBe(
      'Bar Nou — Carrer dels Almogàvers 1',
    );
  });

  it('is just the name when there is no address', () => {
    expect(placeLabel('Bar Nou')).toBe('Bar Nou');
    expect(placeLabel('Bar Nou', null)).toBe('Bar Nou');
    expect(placeLabel('Bar Nou', '   ')).toBe('Bar Nou');
  });

  it('never exceeds what the column accepts', () => {
    const long = placeLabel('x'.repeat(150), 'y'.repeat(400));
    expect(long.length).toBeLessThanOrEqual(PLAN_LOCATION_MAX);
  });

  it('keeps the whole name when something has to go', () => {
    // Recognising the venue matters more than navigating to it.
    const name = 'A Very Long Restaurant Name That Goes On';
    expect(placeLabel(name, 'z'.repeat(400)).startsWith(name)).toBe(true);
  });

  it('survives a name longer than the column on its own', () => {
    const label = placeLabel('n'.repeat(400), 'a'.repeat(400));
    expect(label.length).toBe(PLAN_LOCATION_MAX);
  });
});

describe('mapsLinkFor', () => {
  it('uses coordinates when it has them', () => {
    const target = { name: 'Bar Nou', coordinates: { latitude: 41.385064, longitude: 2.173404 } };
    expect(mapsLinkFor(target, 'ios')).toContain('ll=41.385064,2.173404');
    expect(mapsLinkFor(target, 'android')).toContain('geo:41.385064,2.173404');
  });

  it('falls back to the typed label when it has none', () => {
    // The manual case: no key was ever configured, and this still works.
    expect(mapsLinkFor({ name: 'Bar Nou' }, 'ios')).toBe('https://maps.apple.com/?q=Bar%20Nou');
    expect(mapsLinkFor({ name: 'Bar Nou' }, 'android')).toBe('geo:0,0?q=Bar%20Nou');
  });

  it('escapes a name that would otherwise break the URL', () => {
    const link = mapsLinkFor({ name: 'Q&A Bar', address: 'a/b #3' }, 'ios');
    expect(link).not.toContain('&A');
    expect(link).toContain('%26');
    expect(link).toContain('%23');
  });

  it('only ever produces an OS scheme, never a provider endpoint', () => {
    for (const platform of ['ios', 'android'] as const) {
      expect(mapsLinkFor({ name: 'x' }, platform)).toMatch(/^(https:\/\/maps\.apple\.com|geo:)/);
    }
  });
});
