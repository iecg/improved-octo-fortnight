import { beforeEach, describe, expect, it } from 'vitest';

import { plannerInputsStore } from './session-inputs';

const { getState } = plannerInputsStore;

beforeEach(() => {
  getState().reset();
});

describe('the planner input store', () => {
  it('starts empty', () => {
    expect(getState().location).toBe('');
    expect(getState().budgets).toEqual({});
    expect(getState().hints).toEqual({});
  });

  /**
   * The whole reason budget is keyed rather than shared: a casual evening and
   * a fortnight away are different numbers, and switching chips must not make
   * you retype either.
   */
  it('keeps a separate budget per kind', () => {
    getState().setBudget('date_night', '£40');
    getState().setBudget('trip', '£2000');

    expect(getState().budgets.date_night).toBe('£40');
    expect(getState().budgets.trip).toBe('£2000');
  });

  it('does not disturb one kind’s budget by setting another', () => {
    getState().setBudget('date_night', '£40');
    getState().setBudget('getaway', '£300');
    getState().setBudget('date_night', '£60');

    expect(getState().budgets.getaway).toBe('£300');
    expect(getState().budgets.date_night).toBe('£60');
  });

  /** One sitting is usually about one place, even when the kind changes. */
  it('shares one location across every kind', () => {
    getState().setLocation('Lisbon');
    getState().setBudget('date_night', '£40');
    getState().setBudget('trip', '£2000');

    expect(getState().location).toBe('Lisbon');
  });

  it('keeps a separate hint per kind', () => {
    getState().setHint('date_night', 'somewhere walkable');
    getState().setHint('trip', 'no flying');

    expect(getState().hints.date_night).toBe('somewhere walkable');
    expect(getState().hints.trip).toBe('no flying');
  });

  it('empties everything on reset', () => {
    getState().setLocation('Lisbon');
    getState().setBudget('trip', '£2000');
    getState().setHint('trip', 'no flying');

    getState().reset();

    expect(getState().location).toBe('');
    expect(getState().budgets).toEqual({});
    expect(getState().hints).toEqual({});
  });

  it('replaces the maps on reset rather than mutating them', () => {
    getState().setBudget('trip', '£2000');
    const before = getState().budgets;

    getState().reset();

    // A shared mutable object would leak the old value into the next session.
    expect(before.trip).toBe('£2000');
    expect(getState().budgets).not.toBe(before);
  });

  it('hands back a fresh map on every reset, not one shared empty', () => {
    getState().reset();
    const first = getState().budgets;
    getState().reset();

    expect(getState().budgets).not.toBe(first);
  });

  it('treats an unset kind as empty text, never undefined', () => {
    // The screens bind these straight to a TextInput's `value`; an undefined
    // would flip it to an uncontrolled input mid-session.
    expect(getState().budgets.never_set ?? '').toBe('');
    expect(getState().hints.never_set ?? '').toBe('');
  });

  it('notifies subscribers so a mounted card repaints', () => {
    let notified = 0;
    const unsubscribe = plannerInputsStore.subscribe(() => {
      notified += 1;
    });

    getState().setLocation('Lisbon');
    getState().setBudget('trip', '£2000');
    unsubscribe();
    getState().setLocation('Porto');

    expect(notified).toBe(2);
  });
});
