/**
 * Which screen the session says we should be on.
 *
 * A pure function, and in `packages/auth` rather than in each app, because
 * until now this expression was duplicated character-for-character in two
 * `_layout.tsx` files and about to be duplicated a third time with a new state
 * added. It stays a *function* rather than a hook because `packages/auth` has
 * no `expo-router` dependency and should not gain one — both apps import this
 * package, and a router in it would be a router in everything. Each app keeps
 * its own eight lines of `useSegments`/`useRouter` plumbing and hands the
 * answer here.
 *
 * Being pure is also what makes the truth table testable, which it never was.
 */
import type { KeyState } from './keys';

export type RouteTarget = '/sign-in' | '/pair' | '/unlock' | '/(tabs)';

export interface RouteIntent {
  /** The route we are on contradicts the session we have. */
  misplaced: boolean;
  /** Where to go instead. Only meaningful when `misplaced`. */
  target: RouteTarget;
}

export function routeIntent(input: {
  session: boolean;
  couple: boolean;
  keyState: KeyState;
  /** `useSegments()[0]` — the route group currently rendered. */
  group: string | undefined;
}): RouteIntent {
  const { session, couple, keyState, group } = input;

  const onSignIn = group === 'sign-in';
  const onPairing = group === 'pair';
  const onUnlock = group === 'unlock';

  /**
   * Paired, but this device cannot read anything yet. The fourth state, and the
   * one the comments in `runtime.ts`, `crypto/store.ts` and `data/mappers.ts`
   * have all been promising: without it, `(tabs)` mounts, queries run, and
   * every mapper meets `MissingCoupleKeyError`.
   */
  const locked = session && couple && keyState === 'absent';

  const misplaced =
    (!session && !onSignIn) ||
    (session && !couple && !onPairing) ||
    (locked && !onUnlock) ||
    // `approve` is deliberately absent from this clause. It is reachable only
    // from a device that already holds the key, and bouncing the approver back
    // to the tabs is exactly the deadlock the screen exists to break: the
    // waiting device cannot be let in by anyone who is not allowed to stand on
    // the screen that lets it in.
    (session && couple && !locked && (onSignIn || onPairing || onUnlock));

  const target: RouteTarget = !session
    ? '/sign-in'
    : !couple
      ? '/pair'
      : locked
        ? '/unlock'
        : '/(tabs)';

  return { misplaced, target };
}
