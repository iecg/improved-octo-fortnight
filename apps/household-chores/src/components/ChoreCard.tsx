import { View } from 'react-native';
import { Body, Card, Heading, Muted } from '@couple/ui';

import { describeCadence } from '@/lib/cadence';
import type { Chore } from '@/types';

export function ChoreCard({ chore, onPress }: { chore: Chore; onPress?: () => void }) {
  const meta = `${describeCadence(chore.cadence_type, chore.cadence_config)} · ${
    chore.assignment_type === 'rotating' ? 'Rotates' : 'Fixed'
  }`;

  const body = (
    <View className="gap-1">
      <Heading>{chore.title}</Heading>
      <Muted>{meta}</Muted>
      {chore.description ? <Body>{chore.description}</Body> : null}
    </View>
  );

  // The card is the tap target, so the accessible name has to be the chore
  // rather than every line of text inside it.
  return onPress ? (
    <Card onPress={onPress} accessibilityLabel={chore.title} className="mb-3">
      {body}
    </Card>
  ) : (
    <Card className="mb-3">{body}</Card>
  );
}
