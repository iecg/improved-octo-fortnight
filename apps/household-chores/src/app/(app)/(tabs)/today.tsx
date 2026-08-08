import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { EmptyState } from '@/components/EmptyState';
import { LoadingScreen } from '@/components/LoadingScreen';
import { TodayChoreList } from '@/components/TodayChoreList';
import { useHousehold } from '@/hooks/useHousehold';
import { useMyTodayInstances } from '@/hooks/useTodayInstances';
import type { ChoreInstanceWithChore } from '@/hooks/useTodayInstances';

export default function TodayScreen() {
  const router = useRouter();
  const { data: membership } = useHousehold();
  const householdId = membership?.household_id;
  const { data: instances, isLoading, isRefetching, refetch } = useMyTodayInstances(householdId);

  const onPressInstance = (instance: ChoreInstanceWithChore) => {
    router.push(`/chore-instance/${instance.id}/complete`);
  };

  if (isLoading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        <Text variant="headlineMedium" style={styles.title}>
          Today
        </Text>

        {instances.length === 0 ? (
          <EmptyState title="Nothing due today" subtitle="Enjoy the free time!" />
        ) : (
          <TodayChoreList instances={instances} onPressInstance={onPressInstance} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 16, flexGrow: 1 },
  title: { marginBottom: 16 },
});
