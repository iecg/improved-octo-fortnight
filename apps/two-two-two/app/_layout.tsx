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

  useEffect(() => {
    if (loading) return;
    const group = segments[0];
    const onSignIn = group === 'sign-in';
    const onPairing = group === 'pair';

    if (!session && !onSignIn) router.replace('/sign-in');
    else if (session && !couple && !onPairing) router.replace('/pair');
    else if (session && couple && (onSignIn || onPairing)) router.replace('/(tabs)');
  }, [loading, session, couple, segments, router]);

  if (loading) return <Loading />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="pair" />
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
