/**
 * What the user typed into the suggestion form, kept for the session.
 *
 * Three fields, with different lifetimes on purpose:
 *
 *  - **Location is shared across kinds.** In one sitting you are usually
 *    planning around one place, so naming it once should cover the evening out
 *    and the weekend away alike.
 *  - **Budget is per kind.** A casual evening and a fortnight away are
 *    different numbers, and a single field cannot hold both without being
 *    retyped every time the chips move.
 *  - **The hint is per kind** for the same reason: what steers a date night is
 *    rarely what steers a long trip.
 *
 * Held in memory and nowhere else. There is deliberately no `persist`
 * middleware and nothing reaches `expo-secure-store`: the convenience worth
 * having is not retyping your city while you are sitting there deciding, which
 * a session-lived store gives you in full. Storing it at rest would buy the
 * next launch a head start and leave a place-you-go on disk to do it, which is
 * a bad trade for something two seconds of typing replaces.
 *
 * A store rather than component state because the card can unmount — a tab
 * change, a navigation, a re-render high up — and whether a screen survives
 * that is a navigator implementation detail. "Your city is still there" should
 * not rest on one.
 *
 * The state itself is a plain vanilla store, so every rule above is testable
 * under Node with no renderer. `useStore` appears only at the component
 * boundary, the same split `packages/device/src/sync.ts` uses to keep
 * `reconcileDevice` testable while `useDeviceSync` is not.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface PlannerInputsState {
  /** Shared across kinds. */
  location: string;
  /** Keyed by kind. A missing entry reads as empty, never as undefined. */
  budgets: Record<string, string>;
  /** Keyed by kind. */
  hints: Record<string, string>;
  setLocation(value: string): void;
  setBudget(kind: string, value: string): void;
  setHint(kind: string, value: string): void;
  /**
   * Empty everything. Signing out should not leave the next person holding the
   * last one's city, and this store outlives the screen that fills it.
   */
  reset(): void;
}

/**
 * A function rather than a shared constant, so a reset never hands back the
 * same two maps it handed back last time. Nothing mutates them in place today
 * — every setter spreads — but a shared empty object is the kind of thing that
 * only bites once someone writes the one line that does.
 */
const empty = () => ({ location: '', budgets: {}, hints: {} });

export const plannerInputsStore = createStore<PlannerInputsState>((set) => ({
  ...empty(),
  setLocation: (value) => set({ location: value }),
  setBudget: (kind, value) => set((state) => ({ budgets: { ...state.budgets, [kind]: value } })),
  setHint: (kind, value) => set((state) => ({ hints: { ...state.hints, [kind]: value } })),
  reset: () => set(empty()),
}));

/**
 * Called on sign-out. The store outlives every screen that fills it, so
 * without this the next person to sign in on this phone inherits the last
 * one's city and budgets.
 */
export function resetPlannerInputs(): void {
  plannerInputsStore.getState().reset();
}

export interface PlannerInputs {
  location: string;
  budget: string;
  hint: string;
  setLocation(value: string): void;
  setBudget(value: string): void;
  setHint(value: string): void;
}

/**
 * The store narrowed to one kind, which is all a screen ever wants.
 *
 * Every selector returns a primitive. Selecting an object literal would build a
 * new reference on each call and loop under `useSyncExternalStore`, which is
 * the one way this store could go wrong at runtime.
 */
export function usePlannerInputs(kind: string): PlannerInputs {
  const location = useStore(plannerInputsStore, (state) => state.location);
  const budget = useStore(plannerInputsStore, (state) => state.budgets[kind] ?? '');
  const hint = useStore(plannerInputsStore, (state) => state.hints[kind] ?? '');
  const setLocation = useStore(plannerInputsStore, (state) => state.setLocation);
  const setBudget = useStore(plannerInputsStore, (state) => state.setBudget);
  const setHint = useStore(plannerInputsStore, (state) => state.setHint);

  return {
    location,
    budget,
    hint,
    setLocation,
    setBudget: (value) => setBudget(kind, value),
    setHint: (value) => setHint(kind, value),
  };
}
