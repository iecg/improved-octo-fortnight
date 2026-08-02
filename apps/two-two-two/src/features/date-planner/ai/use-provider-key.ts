/**
 * Key state for one provider, and the selection shared between the two cards.
 *
 * Neither hook ever hands the key back out. The settings card holds what the
 * user is typing in its own state, and the suggestion card reads the stored key
 * from the keychain at the moment it needs it — a secret sitting in React state
 * across renders is a secret in more places than it needs to be.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearProviderKey,
  readProviderKey,
  readProviderModel,
  readSelectedProvider,
  writeProviderKey,
  writeProviderModel,
  writeSelectedProvider,
} from './keys';
import { AI_PROVIDER_IDS, AI_PROVIDERS, type AiProviderId } from './providers';

export type KeyStatus = 'loading' | 'present' | 'absent';

const FIRST_PROVIDER: AiProviderId = AI_PROVIDER_IDS[0];

export interface SelectedProvider {
  provider: AiProviderId;
  select(id: AiProviderId): void;
}

/** The user's last choice, remembered across launches. */
export function useSelectedProvider(): SelectedProvider {
  const [provider, setProvider] = useState<AiProviderId>(FIRST_PROVIDER);

  useEffect(() => {
    let cancelled = false;
    void readSelectedProvider().then((stored) => {
      if (cancelled || stored === null) return;
      setProvider(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((id: AiProviderId) => {
    setProvider(id);
    // Fire and forget: the choice is a convenience, and a failed write costs
    // the user one tap next launch.
    void writeSelectedProvider(id);
  }, []);

  return { provider, select };
}

export interface ProviderKeyHandle {
  status: KeyStatus;
  /** The stored override, or '' meaning "use the catalog default". */
  model: string;
  defaultModel: string;
  busy: boolean;
  save(rawKey: string): Promise<void>;
  clear(): Promise<void>;
  setModel(model: string): Promise<void>;
}

/** What the keychain said, and which provider it said it about. */
interface LoadedKey {
  provider: AiProviderId;
  present: boolean;
  model: string;
}

export function useProviderKey(provider: AiProviderId): ProviderKeyHandle {
  const [loaded, setLoaded] = useState<LoadedKey | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Which provider the user is actually looking at right now.
   *
   * The effect below covers reads — React tears the old effect down before
   * running the new one, so `cancelled` drops a stale result. Writes are
   * user-initiated and outlive no effect, so they need this ref instead: a
   * save that lands after the user has toggled away must not repaint the
   * other provider's card.
   */
  const current = useRef(provider);

  useEffect(() => {
    current.current = provider;
    let cancelled = false;

    void Promise.all([readProviderKey(provider), readProviderModel(provider)]).then(
      ([key, storedModel]) => {
        if (cancelled) return;
        setLoaded({
          provider,
          present: key !== null && key.length > 0,
          model: storedModel ?? '',
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [provider]);

  /**
   * Derived rather than stored, so toggling providers reads as `loading`
   * immediately — without a synchronous `setState` in the effect body, and
   * without a frame in which one provider's card shows the other's answer.
   */
  const fresh = loaded !== null && loaded.provider === provider ? loaded : null;
  const status: KeyStatus = fresh === null ? 'loading' : fresh.present ? 'present' : 'absent';

  /** Commit a local change, but only if the user is still on that card. */
  const patch = useCallback(
    (target: AiProviderId, change: Partial<Omit<LoadedKey, 'provider'>>) => {
      setLoaded((previous) =>
        previous !== null && previous.provider === target ? { ...previous, ...change } : previous,
      );
    },
    [],
  );

  const save = useCallback(
    async (rawKey: string) => {
      const target = provider;
      setBusy(true);
      try {
        // Deliberately not abortable. A half-written key is worse than a slow
        // one, so the write completes even if the user has navigated away.
        await writeProviderKey(target, rawKey);
        patch(target, { present: true });
      } finally {
        if (current.current === target) setBusy(false);
      }
    },
    [provider, patch],
  );

  const clear = useCallback(async () => {
    const target = provider;
    setBusy(true);
    try {
      await clearProviderKey(target);
      patch(target, { present: false });
    } finally {
      if (current.current === target) setBusy(false);
    }
  }, [provider, patch]);

  const setModel = useCallback(
    async (next: string) => {
      const target = provider;
      patch(target, { model: next });
      await writeProviderModel(target, next);
    },
    [provider, patch],
  );

  return {
    status,
    model: fresh?.model ?? '',
    defaultModel: AI_PROVIDERS[provider].defaultModel,
    busy,
    save,
    clear,
    setModel,
  };
}
