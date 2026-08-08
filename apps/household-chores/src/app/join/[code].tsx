import { Loading } from '@couple/ui';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/hooks/useAuth';
import { useHousehold } from '@/hooks/useHousehold';

/**
 * Public forwarder for `choresapp://join/CODE` invite links. Not wrapped in
 * a Stack.Protected guard so it's reachable from any auth state; it figures
 * out where to send the user itself.
 */
export default function JoinDeepLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { session, loading: authLoading } = useAuth();
  const { data: membership, isLoading: householdLoading, isFetched } = useHousehold();

  if (authLoading || (session && !isFetched)) return <Loading />;

  if (!session) {
    // MVP simplification: no "continue after login" chaining — the user
    // signs in and taps the invite link again.
    return <Redirect href="/(auth)/login" />;
  }

  if (membership) {
    // MVP supports one household per user; already in one.
    return <Redirect href="/(app)/(tabs)/today" />;
  }

  if (!householdLoading) {
    return <Redirect href={{ pathname: '/(onboarding)/join-household', params: { code } }} />;
  }

  return <Loading />;
}
