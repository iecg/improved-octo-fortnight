import '../global.css';

import { Loading } from '@couple/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { i18n } from '../src/runtime';
import { SessionProvider, useSession } from '../src/session';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/**
 * Same three states as the other app — signed out, unpaired, paired — because
 * they share one account and one pairing. No app lock here: a 2-2-2 tracker
 * has nothing to hide, and demanding Face ID for a date-night countdown would
 * be friction with no payoff.
 */
function RootNavigator() {
  const { loading, session, couple } = useSession();
  const segments = useSegments();
  const router = useRouter();

  const group = segments[0];
  const onSignIn = group === 'sign-in';
  const onPairing = group === 'pair';

  /**
   * Whether the route we are on contradicts the session we have. Known during
   * render, not only inside the effect: `(tabs)` is the initial route, so on a
   * cold start with no session it mounts, `usePairedSession()` throws, and a
   * new user's first screen is a red one. Effects run after the render that
   * broke.
   */
  const misplaced =
    (!session && !onSignIn) ||
    (!!session && !couple && !onPairing) ||
    (!!session && !!couple && (onSignIn || onPairing));

  useEffect(() => {
    if (loading || !misplaced) return;

    if (!session) router.replace('/sign-in');
    else if (!couple) router.replace('/pair');
    else router.replace('/(tabs)');
  }, [loading, misplaced, session, couple, router]);

  if (loading || misplaced) return <Loading />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="pair" />
      <Stack.Screen name="plan/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="connected" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <StatusBar style="auto" />
              <RootNavigator />
            </SessionProvider>
          </QueryClientProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
