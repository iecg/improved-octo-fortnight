import { Body, Button, ErrorText, Field, Heading, Loading, Muted, Screen } from '@couple/ui';
import { useState } from 'react';
import { View } from 'react-native';

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
    'idle',
  );

  if (isLoading || !profile) return <Loading />;

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
    <Screen tabbed>
      <View className="items-center gap-2">
        <MemberAvatar name={profile.full_name} />
        <Muted>{session?.user.email}</Muted>
      </View>

      <Field
        label="Name"
        hint="Saved automatically"
        value={currentName}
        onChangeText={setName}
        onBlur={saveName}
      />

      <View className="gap-2">
        <Heading>Notifications</Heading>
        <Body>Get a daily reminder for chores due today.</Body>
        <Button
          label={notifStatus === 'registered' ? 'Notifications enabled' : 'Enable notifications'}
          variant="secondary"
          onPress={enableNotifications}
          loading={notifStatus === 'registering'}
        />
        {notifStatus === 'denied' ? (
          <ErrorText>Permission denied, or no EAS project configured yet.</ErrorText>
        ) : null}
      </View>

      <Button label="Sign out" variant="ghost" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
