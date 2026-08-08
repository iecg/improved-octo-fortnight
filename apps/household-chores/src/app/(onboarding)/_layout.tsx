import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen
        name="create-household"
        options={{ headerShown: true, title: 'Create household' }}
      />
      <Stack.Screen
        name="join-household"
        options={{ headerShown: true, title: 'Join household' }}
      />
    </Stack>
  );
}
