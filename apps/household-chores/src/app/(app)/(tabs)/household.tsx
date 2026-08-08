import { Body, Button, Heading, Loading, Muted, Row, Screen, Title } from '@couple/ui';
import { Alert, View } from 'react-native';

import { InviteCodeShare } from '@/components/InviteCodeShare';
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

  if (isLoading || !membership) return <Loading />;

  const isOwner = membership.role === 'owner';

  // The system alert rather than a bespoke dialog: it is the confirmation
  // people already know, it reads correctly to VoiceOver without any work here,
  // and it means this screen holds no dismissable state to get out of sync.
  const confirmLeave = () =>
    Alert.alert(
      'Leave this household?',
      "You'll lose access to its chores. You can rejoin later with the invite code.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => void leaveHousehold.mutateAsync(),
        },
      ],
    );

  return (
    <Screen tabbed>
      <Title>{membership.households.name}</Title>

      <InviteCodeShare
        code={membership.households.invite_code}
        householdName={membership.households.name}
        canRegenerate={isOwner}
        onRegenerate={() => regenerateCode.mutate()}
      />

      <Heading>Members</Heading>
      <View className="gap-3">
        {(members ?? []).map((member) => (
          <Row key={member.id}>
            <MemberAvatar name={member.profiles?.full_name} />
            <View className="shrink gap-0.5">
              <Body>{member.profiles?.full_name ?? 'Household member'}</Body>
              {member.role === 'owner' ? <Muted>Owner</Muted> : null}
            </View>
          </Row>
        ))}
      </View>

      <Button label="Leave household" variant="danger" onPress={confirmLeave} />
    </Screen>
  );
}
