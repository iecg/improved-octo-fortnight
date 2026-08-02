import { describe, expect, it } from 'vitest';

import { routeIntent } from './route';

/**
 * The routing decision, which lived in two `_layout.tsx` files and was covered
 * by nothing. The interesting cases are the two that are easy to get backwards:
 * a keyless device must not reach the tabs, and a device that *has* the key
 * must still be allowed to stand on the approval screen.
 */

const SIGNED_OUT = { session: false, couple: false, keyState: 'absent' } as const;
const UNPAIRED = { session: true, couple: false, keyState: 'absent' } as const;
const LOCKED = { session: true, couple: true, keyState: 'absent' } as const;
const READY = { session: true, couple: true, keyState: 'ready' } as const;

describe('routeIntent', () => {
  it('sends a signed-out visitor to sign-in from anywhere else', () => {
    for (const group of ['(tabs)', 'pair', 'unlock', 'approve', undefined]) {
      expect(routeIntent({ ...SIGNED_OUT, group })).toEqual({
        misplaced: true,
        target: '/sign-in',
      });
    }
    expect(routeIntent({ ...SIGNED_OUT, group: 'sign-in' }).misplaced).toBe(false);
  });

  it('sends a signed-in stranger to pairing', () => {
    expect(routeIntent({ ...UNPAIRED, group: '(tabs)' })).toEqual({
      misplaced: true,
      target: '/pair',
    });
    expect(routeIntent({ ...UNPAIRED, group: 'pair' }).misplaced).toBe(false);
  });

  it('holds a paired but keyless device on unlock', () => {
    // The whole point of the fourth state. Reaching `(tabs)` here means every
    // query runs against a cipher with no key.
    for (const group of ['(tabs)', 'sign-in', 'pair', 'approve', undefined]) {
      expect(routeIntent({ ...LOCKED, group })).toEqual({ misplaced: true, target: '/unlock' });
    }
    expect(routeIntent({ ...LOCKED, group: 'unlock' }).misplaced).toBe(false);
  });

  it('lets a device that holds the key stand on the approval screen', () => {
    // If this were misplaced, nobody could ever approve anybody: the only
    // device allowed to approve is one that already has the key, and it would
    // be bounced to the tabs on arrival.
    expect(routeIntent({ ...READY, group: 'approve' }).misplaced).toBe(false);
  });

  it('sends a ready device out of the three pre-key screens', () => {
    for (const group of ['sign-in', 'pair', 'unlock']) {
      expect(routeIntent({ ...READY, group })).toEqual({ misplaced: true, target: '/(tabs)' });
    }
  });

  it('leaves a ready device alone on the tabs', () => {
    expect(routeIntent({ ...READY, group: '(tabs)' }).misplaced).toBe(false);
    expect(routeIntent({ ...READY, group: undefined }).misplaced).toBe(false);
  });

  it('never reports a target that contradicts the session', () => {
    // `target` is read only when `misplaced`, but a wrong one would send a user
    // in a loop, so it is checked on every combination rather than the ones the
    // cases above happen to visit.
    const groups = ['(tabs)', 'sign-in', 'pair', 'unlock', 'approve', undefined];
    for (const state of [SIGNED_OUT, UNPAIRED, LOCKED, READY]) {
      const expected = !state.session
        ? '/sign-in'
        : !state.couple
          ? '/pair'
          : state.keyState === 'absent'
            ? '/unlock'
            : '/(tabs)';
      for (const group of groups) {
        expect(routeIntent({ ...state, group }).target).toBe(expected);
      }
    }
  });
});
