import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="chore-instance/[instanceId]/complete"
        options={{ presentation: 'modal', headerShown: true, title: 'Complete chore' }}
      />
    </Stack>
  );
}
