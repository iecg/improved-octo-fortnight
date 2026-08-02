/**
 * The accommodation deep link.
 *
 * The timezone cases are the point of this file. A stay is measured in
 * calendar nights, and this suite runs with `TZ=Pacific/Auckland` set by
 * `vitest.config.ts` precisely so that a helper reaching for the host zone —
 * or slicing a UTC ISO string — books the wrong night here and passes on the
 * author's laptop.
 */
import { describe, expect, it } from 'vitest';

import { airbnbSearchUrl, needsSomewhereToStay } from './stays';

/** 4 September 2026, 09:00 in Madrid. */
const MADRID_MORNING = new Date('2026-09-04T07:00:00.000Z');
/** Two nights later, same wall clock. */
const MADRID_CHECKOUT = new Date('2026-09-06T07:00:00.000Z');

describe('needsSomewhereToStay', () => {
  it('is true for the commitments measured in nights', () => {
    expect(needsSomewhereToStay('getaway')).toBe(true);
    expect(needsSomewhereToStay('trip')).toBe(true);
  });

  it('is false for an evening that ends at home', () => {
    expect(needsSomewhereToStay('date_night')).toBe(false);
  });

  it('is false for a kind it has never heard of', () => {
    expect(needsSomewhereToStay('moon_landing')).toBe(false);
  });
});

describe('airbnbSearchUrl', () => {
  const base = { where: 'Girona', timeZone: 'Europe/Madrid' };

  it('carries the place and both dates', () => {
    const url = airbnbSearchUrl({
      ...base,
      startsAt: MADRID_MORNING,
      endsAt: MADRID_CHECKOUT,
    })!;

    expect(url).toContain('/s/Girona/homes');
    expect(url).toContain('checkin=2026-09-04');
    expect(url).toContain('checkout=2026-09-06');
    expect(url).toContain('adults=2');
  });

  /**
   * The bug this function exists to not have.
   *
   * An evening departure in Madrid is still the same calendar date there, and
   * already the next day in UTC. Slicing an ISO string would book the wrong
   * night — and in the other direction for a couple in Auckland.
   */
  it('uses the couple’s calendar date, not UTC', () => {
    // 22:00 on the 4th in Madrid is 20:00 UTC on the 4th…
    const eveningDeparture = new Date('2026-09-04T20:00:00.000Z');
    const url = airbnbSearchUrl({
      ...base,
      startsAt: eveningDeparture,
      endsAt: MADRID_CHECKOUT,
    })!;
    expect(url).toContain('checkin=2026-09-04');

    // …and 08:00 on the 5th in Auckland, which is a different night entirely.
    const auckland = airbnbSearchUrl({
      where: 'Rotorua',
      timeZone: 'Pacific/Auckland',
      startsAt: eveningDeparture,
      endsAt: new Date('2026-09-06T20:00:00.000Z'),
    })!;
    expect(auckland).toContain('checkin=2026-09-05');
    expect(auckland).toContain('checkout=2026-09-07');
  });

  it('survives a stay that crosses a DST change', () => {
    // Europe/Madrid falls back on 25 October 2026. Three nights across it are
    // still three calendar dates apart, however many hours elapse.
    const url = airbnbSearchUrl({
      ...base,
      startsAt: new Date('2026-10-23T14:00:00.000Z'),
      endsAt: new Date('2026-10-26T15:00:00.000Z'),
    })!;
    expect(url).toContain('checkin=2026-10-23');
    expect(url).toContain('checkout=2026-10-26');
  });

  it('returns null rather than a link to an error page', () => {
    // No place to search.
    expect(
      airbnbSearchUrl({ ...base, where: '   ', startsAt: MADRID_MORNING, endsAt: MADRID_CHECKOUT }),
    ).toBeNull();

    // A window that does not span a night. Airbnb rejects these, so we do too
    // rather than sending someone to find that out.
    expect(
      airbnbSearchUrl({ ...base, startsAt: MADRID_MORNING, endsAt: MADRID_MORNING }),
    ).toBeNull();
    expect(
      airbnbSearchUrl({ ...base, startsAt: MADRID_CHECKOUT, endsAt: MADRID_MORNING }),
    ).toBeNull();
  });

  it('escapes a place name that would otherwise break the path', () => {
    const url = airbnbSearchUrl({
      ...base,
      where: 'Sant Feliu de Guíxols, Girona',
      startsAt: MADRID_MORNING,
      endsAt: MADRID_CHECKOUT,
    })!;

    expect(url).toContain('Gu%C3%ADxols');
    expect(url).not.toContain(' ');
    // The query still parses as a query.
    expect(new URL(url).searchParams.get('checkin')).toBe('2026-09-04');
  });

  it('collapses the whitespace a soft keyboard leaves behind', () => {
    const url = airbnbSearchUrl({
      ...base,
      where: '  Girona   Spain ',
      startsAt: MADRID_MORNING,
      endsAt: MADRID_CHECKOUT,
    })!;
    expect(url).toContain('/s/Girona%20Spain/homes');
  });

  /**
   * Deliberate, and worth a test so that adding one is a decision someone has
   * to make on purpose rather than a parameter that slips in.
   */
  it('carries no affiliate or referral tag', () => {
    const url = airbnbSearchUrl({
      ...base,
      startsAt: MADRID_MORNING,
      endsAt: MADRID_CHECKOUT,
    })!;
    const params = new URL(url).searchParams;

    expect([...params.keys()].sort()).toEqual(['adults', 'checkin', 'checkout']);
  });
});
