import { useLocalSearchParams, useRouter } from 'expo-router';

import { ChoreForm } from '@/components/ChoreForm';
import { LoadingScreen } from '@/components/LoadingScreen';
import { useChore } from '@/hooks/useChores';
import { useHousehold } from '@/hooks/useHousehold';

export default function EditChoreScreen() {
  const { choreId } = useLocalSearchParams<{ choreId: string }>();
  const router = useRouter();
  const { data: membership } = useHousehold();
  const { data: chore, isLoading } = useChore(choreId);

  if (isLoading || !chore || !membership) return <LoadingScreen />;

  return (
    <ChoreForm householdId={membership.household_id} chore={chore} onSaved={() => router.back()} />
  );
}
