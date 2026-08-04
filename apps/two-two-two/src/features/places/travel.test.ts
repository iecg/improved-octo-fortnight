/**
 * The drive-time filter.
 *
 * The case that matters most is the one with no data in it: with nothing
 * configured every duration is unknown, and the filter must then be a no-op
 * rather than an empty screen.
 */
import { describe, expect, it } from 'vitest';

import { driveBudgetFor, driveTimeLabel, withinDriveBudget } from './travel';

describe('driveBudgetFor', () => {
  it('only budgets the commitment that has a plausible radius', () => {
    expect(driveBudgetFor('getaway')).toBe(120);
    expect(driveBudgetFor('date_night')).toBeNull();
    expect(driveBudgetFor('trip')).toBeNull();
  });

  it('has no opinion about a kind it has never heard of', () => {
    // Kinds are a TypeScript constant, so a third app or a new ritual arrives
    // here as an unknown slug rather than a migration.
    expect(driveBudgetFor('moon_landing')).toBeNull();
  });
});

describe('withinDriveBudget', () => {
  const places = ['near', 'far', 'unknown'];

  it('drops what is definitely too far', () => {
    expect(withinDriveBudget(places, [30, 400, null], 120)).toEqual(['near', 'unknown']);
  });

  it('keeps everything when there is no budget', () => {
    expect(withinDriveBudget(places, [30, 400, null], null)).toEqual(places);
  });

  it('keeps everything when nothing is known', () => {
    // The no-provider case: every duration is null, so the filter is a no-op
    // and the couple sees the full list rather than an empty one.
    expect(withinDriveBudget(places, [null, null, null], 120)).toEqual(places);
  });

  it('treats a missing entry as unknown rather than as zero', () => {
    expect(withinDriveBudget(places, [], 120)).toEqual(places);
  });

  it('keeps a journey exactly at the budget', () => {
    expect(withinDriveBudget(['edge'], [120], 120)).toEqual(['edge']);
  });

  it('does not mutate what it was given', () => {
    const input = [...places];
    withinDriveBudget(input, [30, 400, null], 120);
    expect(input).toEqual(places);
  });
});

describe('driveTimeLabel', () => {
  it('returns a key and a count, never a sentence', () => {
    // Pluralization happens in t(), in each partner's own language.
    const label = driveTimeLabel(35);
    expect(label.key).toBe('places:travel.minutes');
    expect(typeof label.count).toBe('number');
  });

  it('rounds minutes to something a person would say', () => {
    expect(driveTimeLabel(32).count).toBe(30);
    expect(driveTimeLabel(38).count).toBe(40);
  });

  it('never rounds a real journey down to nothing', () => {
    expect(driveTimeLabel(1).count).toBe(5);
  });

  it('switches to halves of an hour past ninety minutes', () => {
    expect(driveTimeLabel(120)).toEqual({ key: 'places:travel.hours', count: 2 });
    expect(driveTimeLabel(150)).toEqual({ key: 'places:travel.hours', count: 2.5 });
  });

  it('has a key for not knowing', () => {
    expect(driveTimeLabel(null).key).toBe('places:travel.unknown');
    expect(driveTimeLabel(Number.NaN).key).toBe('places:travel.unknown');
  });
});
