import '../global.css';

import { configureNotificationHandler } from '@couple/device';
import { Loading } from '@couple/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppLockGate } from '../src/lock';
import { i18n } from '../src/runtime';
import { SessionProvider, useSession } from '../src/session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A couple's schedule does not change by the second, and refetching on
      // every focus would spend battery for nothing. Realtime handles the
      // updates that actually matter.
      staleTime: 30_000,
      retry: 1,
    },
  },
});

configureNotificationHandler();

/**
 * Routing follows the three states the app can be in: signed out, signed in
 * but unpaired, and paired. Doing it here rather than in each screen means no
 * screen has to defend against being reached in the wrong state.
 */
function RootNavigator() {
  const { loading, session, couple } = useSession();
  const segments = useSegments();
  const router = useRouter();

  const group = segments[0];
  const onSignIn = group === 'sign-in';
  const onPairing = group === 'pair';

  /**
   * Whether the route we are on contradicts the session we have.
   *
   * This has to be known during render, not only inside the effect below.
   * `(tabs)` is the initial route, so on a cold start with no session it
   * mounts, `usePairedSession()` finds no profile and throws, and the very
   * first thing a new user sees is a red screen — the redirect is queued in an
   * effect and effects run after the render that broke.
   */
  const misplaced =
    (!session && !onSignIn) ||
    (!!session && !couple && !onPairing) ||
    (!!session && !!couple && (onSignIn || onPairing));

  useEffect(() => {
    if (loading || !misplaced) return;

    if (!session) {
      router.replace('/sign-in');
    } else if (!couple) {
      router.replace('/pair');
    } else {
      router.replace('/(tabs)');
    }
  }, [loading, misplaced, session, couple, router]);

  // Hold the spinner until the route agrees with the session, rather than
  // mounting a screen that is about to be navigated away from.
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
            <AppLockGate>
              <SessionProvider>
                <StatusBar style="auto" />
                <RootNavigator />
              </SessionProvider>
            </AppLockGate>
          </QueryClientProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
