import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from 'react-native-paper';

import { supabase } from '@/lib/supabase';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text variant="headlineMedium" style={styles.title}>
          Let&apos;s get your household set up
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          Create a new household, or join one with an invite code from a housemate.
        </Text>

        <View style={styles.actions}>
          <Button mode="contained" onPress={() => router.push('/(onboarding)/create-household')}>
            Create a household
          </Button>
          <Button mode="outlined" onPress={() => router.push('/(onboarding)/join-household')}>
            Join with a code
          </Button>
        </View>

        <Button style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 24 },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', opacity: 0.7 },
  actions: { gap: 12 },
  signOut: { marginTop: 24 },
});
