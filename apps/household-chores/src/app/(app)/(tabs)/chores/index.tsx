import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FAB, Loading } from '@couple/ui';
import { useRouter } from 'expo-router';
import { FlatList, View } from 'react-native';

import { ChoreCard } from '@/components/ChoreCard';
import { EmptyState } from '@/components/EmptyState';
import { useChores } from '@/hooks/useChores';
import { useHousehold } from '@/hooks/useHousehold';

export default function ChoresListScreen() {
  const router = useRouter();
  const { data: membership } = useHousehold();
  const householdId = membership?.household_id;
  const { data: chores, isLoading } = useChores(householdId);

  if (isLoading) return <Loading />;

  return (
    <View className="flex-1 bg-canvas dark:bg-canvas-dark">
      <FlatList
        data={chores}
        keyExtractor={(item) => item.id}
        contentContainerClassName="grow p-4"
        renderItem={({ item }) => (
          <ChoreCard chore={item} onPress={() => router.push(`/chores/${item.id}`)} />
        )}
        ListEmptyComponent={
          <EmptyState
            title="No chores yet"
            subtitle="Tap the + button to add your household's first chore."
          />
        }
      />
      <FAB
        icon={<MaterialCommunityIcons name="plus" color="#FFFFFF" size={28} />}
        accessibilityLabel="New chore"
        onPress={() => router.push('/chores/new')}
      />
    </View>
  );
}
