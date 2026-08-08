import { Stack } from 'expo-router';

export default function ChoresLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Chores' }} />
      <Stack.Screen name="new" options={{ title: 'New chore', presentation: 'modal' }} />
      <Stack.Screen name="[choreId]/index" options={{ title: 'Chore' }} />
      <Stack.Screen
        name="[choreId]/edit"
        options={{ title: 'Edit chore', presentation: 'modal' }}
      />
    </Stack>
  );
}
