import { StyleSheet } from 'react-native';
import { Card, Text } from 'react-native-paper';

import { describeCadence } from '@/lib/cadence';
import type { Chore } from '@/types';

export function ChoreCard({ chore, onPress }: { chore: Chore; onPress?: () => void }) {
  return (
    <Card style={styles.card} onPress={onPress}>
      <Card.Content>
        <Text variant="titleMedium">{chore.title}</Text>
        <Text variant="bodySmall" style={styles.meta}>
          {describeCadence(chore.cadence_type, chore.cadence_config)} ·{' '}
          {chore.assignment_type === 'rotating' ? 'Rotates' : 'Fixed'}
        </Text>
        {chore.description ? (
          <Text variant="bodyMedium" style={styles.description}>
            {chore.description}
          </Text>
        ) : null}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  meta: { opacity: 0.6, marginTop: 4 },
  description: { marginTop: 8 },
});
