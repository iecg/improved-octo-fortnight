import { Button, Muted, Screen, Title } from '@couple/ui';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { supabase } from '@/lib/supabase';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <Screen scroll={false}>
      <View className="flex-1 justify-center gap-6">
        <View className="items-center gap-2">
          <Title>Let&apos;s get your household set up</Title>
          <Muted>Create a new household, or join one with an invite code from a housemate.</Muted>
        </View>

        <View className="gap-3">
          <Button
            label="Create a household"
            onPress={() => router.push('/(onboarding)/create-household')}
          />
          <Button
            label="Join with a code"
            variant="secondary"
            onPress={() => router.push('/(onboarding)/join-household')}
          />
        </View>

        <Button label="Sign out" variant="ghost" onPress={() => supabase.auth.signOut()} />
      </View>
    </Screen>
  );
}
