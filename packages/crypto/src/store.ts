/**
 * Where the couple key lives while the app is running.
 *
 * A holder, not storage. Persistence is `packages/device`'s job; this is the
 * in-memory box the session fills in once the key has been unwrapped, and it
 * exists to solve one ordering problem: the apps build their repositories as
 * module-level singletons (each app's `src/queries.ts`), so a cipher has to be
 * constructible before any key exists.
 *
 * The alternative was making every repository async or rebuilding them on sign
 * in. Both are larger changes, and both would have moved the scope out of the
 * constructor — which is the one thing invariant 2 says not to do.
 *
 * Asking for a key before there is one throws. The router is what makes that
 * unreachable in practice: a paired session with no key routes to the recovery
 * screen, not to the tabs.
 */
import { deriveContentKey, type ContentKey, type CoupleRootKey, type KeyScope } from './keys';

export class MissingCoupleKeyError extends Error {
  constructor() {
    super('this device does not hold the couple key yet');
  }
}

export interface CoupleKeyStore {
  status(): 'absent' | 'ready';
  /** The couple key, once a device has unwrapped it. */
  set(root: CoupleRootKey, coupleId: string, epoch: number): void;
  clear(): void;
  contentKey(scope: KeyScope): ContentKey;
  readonly coupleId: string | null;
  readonly epoch: number;
}

export function createCoupleKeyStore(): CoupleKeyStore {
  let root: CoupleRootKey | null = null;
  let couple: string | null = null;
  let generation = 0;

  // Derivation is HKDF over 32 bytes — cheap, but it happens on every mapped
  // row, and a list of plans is one derivation per row without this.
  let derived = new Map<KeyScope, ContentKey>();

  return {
    status() {
      return root === null ? 'absent' : 'ready';
    },

    set(next, nextCouple, nextEpoch) {
      root = next;
      couple = nextCouple;
      generation = nextEpoch;
      derived = new Map();
    },

    clear() {
      // Zeroing is best-effort in a garbage-collected runtime — the engine may
      // have copied the buffer already. Worth doing, not worth trusting.
      root?.fill(0);
      for (const key of derived.values()) key.fill(0);
      root = null;
      couple = null;
      generation = 0;
      derived = new Map();
    },

    contentKey(scope) {
      if (root === null || couple === null) throw new MissingCoupleKeyError();

      const cached = derived.get(scope);
      if (cached) return cached;

      const key = deriveContentKey(root, couple, scope);
      derived.set(scope, key);
      return key;
    },

    get coupleId() {
      return couple;
    },

    get epoch() {
      return generation;
    },
  };
}
