import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { FAB } from 'react-native-paper';

import { ChoreCard } from '@/components/ChoreCard';
import { EmptyState } from '@/components/EmptyState';
import { LoadingScreen } from '@/components/LoadingScreen';
import { useChores } from '@/hooks/useChores';
import { useHousehold } from '@/hooks/useHousehold';

export default function ChoresListScreen() {
  const router = useRouter();
  const { data: membership } = useHousehold();
  const householdId = membership?.household_id;
  const { data: chores, isLoading } = useChores(householdId);

  if (isLoading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      <FlatList
        data={chores}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
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
      <FAB style={styles.fab} icon="plus" onPress={() => router.push('/chores/new')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, flexGrow: 1 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
