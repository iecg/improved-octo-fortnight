import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { LoadingScreen } from '@/components/LoadingScreen';
import { paperDarkTheme, paperLightTheme } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useHousehold } from '@/hooks/useHousehold';
import { queryClient } from '@/lib/queryClient';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, loading: authLoading } = useAuth();
  const { data: membership, isLoading: householdLoading, isFetched: householdFetched } =
    useHousehold();

  const ready = !authLoading && (!session || householdFetched);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return <LoadingScreen />;

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

      <Stack.Screen name="join/[code]" options={{ presentation: 'modal', headerShown: true, title: 'Join household' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <QueryClientProvider client={queryClient}>
      <PaperProvider theme={colorScheme === 'dark' ? paperDarkTheme : paperLightTheme}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
      </PaperProvider>
    </QueryClientProvider>
  );
}
