import { Loading } from '@couple/ui';
import { Redirect } from 'expo-router';

import { useAuth } from '@/hooks/useAuth';
import { useHousehold } from '@/hooks/useHousehold';

// Route groups ((auth), (onboarding), (app)) contribute no path segment, and
// none of them owns an index route -- so without this file nothing resolves
// `/` and the app boots straight into expo-router's "Unmatched Route" screen.
// The guard conditions here mirror the <Stack.Protected> guards in _layout.tsx.
export default function Index() {
  const { session, loading: authLoading } = useAuth();
  const { data: membership, isFetched: householdFetched } = useHousehold();

  if (authLoading || (session && !householdFetched)) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  if (!membership) return <Redirect href="/welcome" />;
  return <Redirect href="/today" />;
}
