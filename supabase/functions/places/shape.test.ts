/**
 * The shaping layer, against fixtures.
 *
 * No network, no key, no Deno. Two things matter most here and neither is
 * about happy-path parsing: that a malformed request never reaches a third
 * party, and that a malformed *response* never throws into a screen.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSearchBody,
  coarsen,
  MAX_DESTINATIONS,
  MAX_RESULTS,
  parseRequest,
  SEARCH_FIELD_MASK,
  toPlaceResults,
  toTravelMinutes,
} from './shape';

describe('coarsen', () => {
  it('rounds to about a kilometre', () => {
    expect(coarsen({ latitude: 41.385064, longitude: 2.173404 })).toEqual({
      latitude: 41.39,
      longitude: 2.17,
    });
  });

  it('works across the equator and the meridian', () => {
    expect(coarsen({ latitude: -0.004, longitude: -0.006 })).toEqual({
      latitude: -0,
      longitude: -0.01,
    });
  });
});

describe('parseRequest', () => {
  it('accepts a capabilities probe', () => {
    expect(parseRequest({ op: 'capabilities' })).toEqual({ op: 'capabilities' });
  });

  it.each([
    ['not an object', null],
    ['a string', 'search'],
    ['an unknown op', { op: 'delete_everything' }],
    ['a search with no query', { op: 'search' }],
    ['a search with an empty query', { op: 'search', query: '   ' }],
    ['a search with an oversized query', { op: 'search', query: 'x'.repeat(201) }],
    ['travel time with no origin', { op: 'travelTime', destinations: [] }],
    [
      'travel time with no valid destination',
      { op: 'travelTime', origin: { latitude: 1, longitude: 1 }, destinations: [{ latitude: 1 }] },
    ],
  ])('rejects %s before anything leaves', (_name, body) => {
    expect(parseRequest(body)).toBeNull();
  });

  it('coarsens the search centre it was handed', () => {
    const parsed = parseRequest({
      op: 'search',
      query: 'ramen',
      near: { latitude: 41.385064, longitude: 2.173404 },
    });

    // The client cannot opt out of this by sending a precise position.
    expect(parsed).toMatchObject({ near: { latitude: 41.39, longitude: 2.17 } });
  });

  it('rejects coordinates that are not on Earth', () => {
    const parsed = parseRequest({
      op: 'search',
      query: 'ramen',
      near: { latitude: 991, longitude: 2 },
    });
    // Not a hard failure — the search just loses its centre.
    expect(parsed).toEqual({ op: 'search', query: 'ramen', languageCode: 'en', limit: MAX_RESULTS });
  });

  it('caps the result count and the radius', () => {
    expect(parseRequest({ op: 'search', query: 'x', limit: 500 })).toMatchObject({
      limit: MAX_RESULTS,
    });
    expect(parseRequest({ op: 'search', query: 'x', radiusMeters: 10_000_000 })).toMatchObject({
      radiusMeters: 50_000,
    });
  });

  it('caps the number of destinations', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ latitude: i / 10, longitude: 1 }));
    const parsed = parseRequest({
      op: 'travelTime',
      origin: { latitude: 1, longitude: 1 },
      destinations: many,
    });

    expect(parsed).toBeTruthy();
    expect((parsed as { destinations: unknown[] }).destinations).toHaveLength(MAX_DESTINATIONS);
  });

  it('falls back to English rather than passing an arbitrary language through', () => {
    expect(parseRequest({ op: 'search', query: 'x', languageCode: 'zz' })).toMatchObject({
      languageCode: 'en',
    });
    expect(parseRequest({ op: 'search', query: 'x', languageCode: 'es' })).toMatchObject({
      languageCode: 'es',
    });
  });
});

describe('parseRequest, static map', () => {
  it('clamps a nonsensical size rather than refusing to render', () => {
    expect(
      parseRequest({
        op: 'staticMap',
        center: { latitude: 41.385064, longitude: 2.173404 },
        zoom: 99,
        width: 5000,
        height: 0,
      }),
    ).toEqual({
      op: 'staticMap',
      // Four places here, not two: this is a venue the provider itself named,
      // so it is not new information about the couple — and a map coarsened to
      // a kilometre would not be centred on the venue.
      center: { latitude: 41.3851, longitude: 2.1734 },
      zoom: 20,
      width: 640,
      height: 64,
    });
  });

  it('still refuses a request with no centre', () => {
    expect(parseRequest({ op: 'staticMap', zoom: 15 })).toBeNull();
  });

  it('fills in defaults', () => {
    expect(parseRequest({ op: 'staticMap', center: { latitude: 0, longitude: 0 } })).toMatchObject({
      zoom: 15,
      width: 400,
      height: 200,
    });
  });
});

describe('buildSearchBody', () => {
  it('biases towards a centre rather than restricting to it', () => {
    const body = buildSearchBody({
      op: 'search',
      query: 'ramen',
      near: { latitude: 41.39, longitude: 2.17 },
      languageCode: 'es',
      limit: 5,
    }) as any;

    // A bias still returns the good place one street outside the circle.
    expect(body.locationBias.circle.center).toEqual({ latitude: 41.39, longitude: 2.17 });
    expect(body.locationRestriction).toBeUndefined();
    expect(body.languageCode).toBe('es');
    expect(body.maxResultCount).toBe(5);
  });

  it('omits the bias entirely when there is no centre', () => {
    const body = buildSearchBody({
      op: 'search',
      query: 'ramen in Girona',
      languageCode: 'en',
      limit: 10,
    }) as any;

    expect(body.locationBias).toBeUndefined();
  });
});

describe('SEARCH_FIELD_MASK', () => {
  it('asks for nothing outside the cheapest tier', () => {
    // Each of these is a separate billing tier and its own caching terms.
    for (const expensive of ['photos', 'rating', 'regularOpeningHours', 'editorialSummary']) {
      expect(SEARCH_FIELD_MASK).not.toContain(expensive);
    }
  });
});

describe('toPlaceResults', () => {
  it('reads a well-formed response', () => {
    const results = toPlaceResults({
      places: [
        {
          id: 'abc123',
          displayName: { text: 'Bar Nou', languageCode: 'ca' },
          formattedAddress: 'Carrer dels Almogàvers 1, Barcelona',
          location: { latitude: 41.385064, longitude: 2.173404 },
        },
      ],
    });

    expect(results).toEqual([
      {
        providerPlaceId: 'abc123',
        name: 'Bar Nou',
        address: 'Carrer dels Almogàvers 1, Barcelona',
        coordinates: { latitude: 41.385064, longitude: 2.173404 },
      },
    ]);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an object with no places', {}],
    ['places that is not an array', { places: 'nope' }],
    ['an entry that is not an object', { places: [42] }],
    ['an entry with no id', { places: [{ displayName: { text: 'x' } }] }],
    ['an entry with no name', { places: [{ id: 'a' }] }],
  ])('yields nothing rather than throwing on %s', (_name, body) => {
    expect(toPlaceResults(body)).toEqual([]);
  });

  it('keeps a place that has no coordinates', () => {
    const results = toPlaceResults({ places: [{ id: 'a', displayName: { text: 'Somewhere' } }] });
    expect(results).toHaveLength(1);
    expect(results[0]!.coordinates).toBeNull();
    expect(results[0]!.address).toBeNull();
  });
});

describe('toTravelMinutes', () => {
  it('maps durations onto destination indexes', () => {
    const minutes = toTravelMinutes(
      [
        { destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '5400s' },
        { destinationIndex: 1, condition: 'ROUTE_EXISTS', duration: '600s' },
      ],
      2,
    );

    expect(minutes).toEqual([90, 10]);
  });

  it('leaves an unroutable destination unknown rather than far', () => {
    // Unknown is not "too far" — the filter keeps it, and a person decides.
    const minutes = toTravelMinutes(
      [{ destinationIndex: 0, condition: 'ROUTE_NOT_FOUND', duration: '0s' }],
      2,
    );

    expect(minutes).toEqual([null, null]);
  });

  it.each([
    ['a non-array body', {}],
    ['an out-of-range index', [{ destinationIndex: 9, duration: '60s' }]],
    ['a missing duration', [{ destinationIndex: 0 }]],
    ['an unparseable duration', [{ destinationIndex: 0, duration: 'soon' }]],
  ])('survives %s', (_name, body) => {
    expect(toTravelMinutes(body, 1)).toEqual([null]);
  });
});
