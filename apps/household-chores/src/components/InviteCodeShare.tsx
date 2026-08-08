import * as Linking from 'expo-linking';
import { Share, StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';

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
    <Card style={styles.card}>
      <Card.Content>
        <Text variant="labelLarge">Invite code</Text>
        <Text variant="displaySmall" style={styles.code}>
          {code}
        </Text>
        <View style={styles.actions}>
          <Button mode="contained" icon="share-variant" onPress={share} style={styles.actionButton}>
            Share
          </Button>
          {canRegenerate ? (
            <Button mode="outlined" onPress={onRegenerate} style={styles.actionButton}>
              Regenerate
            </Button>
          ) : null}
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 16 },
  code: { letterSpacing: 4, marginVertical: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  actionButton: { flex: 1 },
});
