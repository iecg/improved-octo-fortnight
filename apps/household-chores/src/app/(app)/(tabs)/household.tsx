import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Dialog, List, Portal, Text } from 'react-native-paper';

import { InviteCodeShare } from '@/components/InviteCodeShare';
import { LoadingScreen } from '@/components/LoadingScreen';
import { MemberAvatar } from '@/components/MemberAvatar';
import {
  useHousehold,
  useHouseholdMembers,
  useLeaveHousehold,
  useRegenerateInviteCode,
} from '@/hooks/useHousehold';

export default function HouseholdScreen() {
  const { data: membership, isLoading } = useHousehold();
  const { data: members } = useHouseholdMembers(membership?.household_id);
  const regenerateCode = useRegenerateInviteCode(membership?.household_id);
  const leaveHousehold = useLeaveHousehold();
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (isLoading || !membership) return <LoadingScreen />;

  const isOwner = membership.role === 'owner';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall" style={styles.title}>
        {membership.households.name}
      </Text>

      <InviteCodeShare
        code={membership.households.invite_code}
        householdName={membership.households.name}
        canRegenerate={isOwner}
        onRegenerate={() => regenerateCode.mutate()}
      />

      <Text variant="labelLarge" style={styles.sectionTitle}>
        Members
      </Text>
      <View style={styles.memberList}>
        {(members ?? []).map((member) => (
          <List.Item
            key={member.id}
            title={member.profiles?.full_name ?? 'Household member'}
            description={member.role === 'owner' ? 'Owner' : undefined}
            left={() => (
              <View style={styles.avatarWrap}>
                <MemberAvatar name={member.profiles?.full_name} />
              </View>
            )}
          />
        ))}
      </View>

      <Button
        mode="outlined"
        textColor="#B3261E"
        style={styles.leaveButton}
        onPress={() => setConfirmLeave(true)}
      >
        Leave household
      </Button>

      <Portal>
        <Dialog visible={confirmLeave} onDismiss={() => setConfirmLeave(false)}>
          <Dialog.Title>Leave this household?</Dialog.Title>
          <Dialog.Content>
            <Text>
              You&apos;ll lose access to its chores. You can rejoin later with the invite code.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmLeave(false)}>Cancel</Button>
            <Button
              textColor="#B3261E"
              onPress={async () => {
                await leaveHousehold.mutateAsync();
                setConfirmLeave(false);
              }}
            >
              Leave
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 16 },
  title: { marginBottom: 16 },
  sectionTitle: { marginTop: 8, marginBottom: 4 },
  memberList: { marginBottom: 24 },
  avatarWrap: { justifyContent: 'center', paddingLeft: 8 },
  leaveButton: { marginTop: 8 },
});
