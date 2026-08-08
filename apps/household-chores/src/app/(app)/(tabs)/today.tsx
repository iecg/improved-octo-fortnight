import { Loading, Title } from '@couple/ui';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
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

  if (isLoading) return <Loading />;

  // Not `Screen`: this one owns its ScrollView so it can carry pull-to-refresh.
  return (
    <SafeAreaView className="flex-1 bg-canvas dark:bg-canvas-dark" edges={['top']}>
      <ScrollView
        contentContainerClassName="grow px-5 py-4"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        <View className="mb-4">
          <Title>Today</Title>
        </View>

        {instances.length === 0 ? (
          <EmptyState title="Nothing due today" subtitle="Enjoy the free time!" />
        ) : (
          <TodayChoreList instances={instances} onPressInstance={onPressInstance} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
