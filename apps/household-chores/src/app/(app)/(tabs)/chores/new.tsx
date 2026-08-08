import { Loading } from '@couple/ui';
import { useRouter } from 'expo-router';

import { ChoreForm } from '@/components/ChoreForm';
import { useHousehold } from '@/hooks/useHousehold';

export default function NewChoreScreen() {
  const router = useRouter();
  const { data: membership } = useHousehold();
  const householdId = membership?.household_id;

  if (!householdId) return <Loading />;

  return <ChoreForm householdId={householdId} onSaved={() => router.back()} />;
}
