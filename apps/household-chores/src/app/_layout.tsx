import '../../global.css';

import { Loading } from '@couple/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useHousehold } from '@/hooks/useHousehold';
import { queryClient } from '@/lib/queryClient';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, loading: authLoading } = useAuth();
  const {
    data: membership,
    isLoading: householdLoading,
    isFetched: householdFetched,
  } = useHousehold();

  const ready = !authLoading && (!session || householdFetched);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return <Loading />;

  const hasSession = !!session;
  const hasHousehold = !!membership;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!hasSession}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={hasSession && !householdLoading && !hasHousehold}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>

      <Stack.Protected guard={hasSession && hasHousehold}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Screen
        name="join/[code]"
        options={{ presentation: 'modal', headerShown: true, title: 'Join household' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/* Navigation chrome only — headers and the tab bar. The screens
              themselves are styled by NativeWind against this app's palette,
              which `darkMode: 'media'` keys off the same system setting. */}
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AuthProvider>
              <StatusBar style="auto" />
              <RootNavigator />
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
