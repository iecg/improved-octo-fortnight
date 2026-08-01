/**
 * The app lock gate.
 *
 * Locks on launch and again whenever the app returns from the background, so
 * handing someone your unlocked phone does not hand them this.
 *
 * Two details that matter more than they look:
 *
 *  - Content is not rendered while locked. Hiding it behind an overlay would
 *    still expose it to the OS app switcher snapshot.
 *  - A failed or cancelled prompt leaves the app locked with a retry, never
 *    unlocked. The failure path has to be the safe one.
 */
import { authenticate, isLockEnabled } from '@couple/device';
import { Button, Screen, Title } from '@couple/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus, View } from 'react-native';
import { useTranslation } from 'react-i18next';

type LockState = 'checking' | 'locked' | 'unlocked';

export function AppLockGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('app');
  const [state, setState] = useState<LockState>('checking');
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const promptToUnlock = useCallback(async () => {
    const success = await authenticate(t('lock.prompt'));
    setState(success ? 'unlocked' : 'locked');
  }, [t]);

  const evaluate = useCallback(async () => {
    if (!(await isLockEnabled())) {
      setState('unlocked');
      return;
    }
    setState('locked');
    await promptToUnlock();
  }, [promptToUnlock]);

  useEffect(() => {
    // The lint rule flags setState in an effect body, but `evaluate` is async
    // and every state change happens after awaiting SecureStore and the OS
    // auth prompt. Reading the lock setting from the keychain and subscribing
    // to foreground transitions is exactly the external-system synchronization
    // effects exist for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void evaluate();

    const subscription = AppState.addEventListener('change', (next) => {
      const returning = appState.current.match(/inactive|background/) && next === 'active';
      appState.current = next;
      if (returning) void evaluate();
    });

    return () => subscription.remove();
  }, [evaluate]);

  if (state === 'unlocked') return <>{children}</>;

  return (
    <Screen scroll={false}>
      <View className="flex-1 items-center justify-center gap-6">
        <Title>{t('lock.locked')}</Title>
        {state === 'locked' ? (
          <Button label={t('lock.unlock')} onPress={() => void promptToUnlock()} />
        ) : null}
      </View>
    </Screen>
  );
}
