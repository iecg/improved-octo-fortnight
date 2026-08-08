import { Button, Card, Heading } from '@couple/ui';
import * as Linking from 'expo-linking';
import { Share, Text, View } from 'react-native';

export function InviteCodeShare({
  code,
  householdName,
  onRegenerate,
  canRegenerate,
}: {
  code: string;
  householdName: string;
  onRegenerate?: () => void;
  canRegenerate?: boolean;
}) {
  const shareLink = Linking.createURL(`join/${code}`);

  const share = () => {
    Share.share({
      message: `Join our household "${householdName}" on Household Chores! Use invite code ${code} or open ${shareLink}`,
    });
  };

  return (
    <Card>
      <View className="gap-3">
        <Heading>Invite code</Heading>
        {/* Selectable and letter-spaced: this is read aloud or copied, and an
            unbroken run of six characters is hard to read out accurately. */}
        <Text
          selectable
          className="text-3xl font-semibold tracking-[6px] text-ink dark:text-ink-dark"
        >
          {code}
        </Text>
        <View className="flex-row gap-3">
          <View className="grow basis-0">
            <Button label="Share" onPress={share} />
          </View>
          {canRegenerate ? (
            <View className="grow basis-0">
              <Button label="Regenerate" variant="secondary" onPress={onRegenerate} />
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}
