import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { LoadingScreen } from '@/components/LoadingScreen';
import { MemberAvatar } from '@/components/MemberAvatar';
import { useAuth } from '@/hooks/useAuth';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import { registerForPushNotificationsAsync } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const { session } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [savedName, setSavedName] = useState(profile?.full_name ?? '');
  const [notifStatus, setNotifStatus] = useState<'idle' | 'registering' | 'registered' | 'denied'>(
    'idle'
  );

  if (isLoading || !profile) return <LoadingScreen />;

  const currentName = name || profile.full_name || '';

  const saveName = async () => {
    if (!currentName.trim() || currentName === savedName) return;
    await updateProfile.mutateAsync(currentName.trim());
    setSavedName(currentName.trim());
  };

  const enableNotifications = async () => {
    setNotifStatus('registering');
    const token = await registerForPushNotificationsAsync();
    setNotifStatus(token ? 'registered' : 'denied');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <MemberAvatar name={profile.full_name} size={64} />
        <Text variant="bodyMedium" style={styles.email}>
          {session?.user.email}
        </Text>
      </View>

      <View style={styles.field}>
        <TextInput label="Name" mode="outlined" value={currentName} onChangeText={setName} onBlur={saveName} />
        <HelperText type="info" visible>
          Saved automatically
        </HelperText>
      </View>

      <View style={styles.field}>
        <Text variant="labelLarge">Notifications</Text>
        <Text variant="bodySmall" style={styles.meta}>
          Get a daily reminder for chores due today.
        </Text>
        <Button
          mode="outlined"
          style={styles.notifButton}
          onPress={enableNotifications}
          loading={notifStatus === 'registering'}
        >
          {notifStatus === 'registered' ? 'Notifications enabled' : 'Enable notifications'}
        </Button>
        {notifStatus === 'denied' ? (
          <HelperText type="error" visible>
            Permission denied, or no EAS project configured yet.
          </HelperText>
        ) : null}
      </View>

      <Button style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        Sign out
      </Button>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 16, gap: 8 },
  header: { alignItems: 'center', gap: 8, marginBottom: 16 },
  email: { opacity: 0.6 },
  field: { marginBottom: 16 },
  meta: { opacity: 0.6, marginBottom: 8 },
  notifButton: { alignSelf: 'flex-start' },
  signOut: { marginTop: 16 },
});
