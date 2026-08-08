import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Card, Checkbox, Text } from 'react-native-paper';

import { useSignedPhotoUrl } from '@/hooks/useSignedPhotoUrl';
import { describeCadence } from '@/lib/cadence';
import type { ChoreInstanceWithChore } from '@/hooks/useTodayInstances';

function InstanceThumbnail({ photoPath }: { photoPath: string }) {
  const { data: url } = useSignedPhotoUrl(photoPath);
  if (!url) return null;
  return <Image source={{ uri: url }} style={styles.thumbnail} contentFit="cover" />;
}

export function TodayChoreList({
  instances,
  onPressInstance,
}: {
  instances: ChoreInstanceWithChore[];
  onPressInstance: (instance: ChoreInstanceWithChore) => void;
}) {
  return (
    <View style={styles.list}>
      {instances.map((instance) => {
        const completed = instance.status === 'completed';
        return (
          <Card
            key={instance.id}
            style={styles.card}
            onPress={completed ? undefined : () => onPressInstance(instance)}
          >
            <Card.Content style={styles.row}>
              <Checkbox status={completed ? 'checked' : 'unchecked'} disabled={completed} />
              <View style={styles.textColumn}>
                <Text variant="titleMedium" style={completed ? styles.strikethrough : undefined}>
                  {instance.chores.title}
                </Text>
                <Text variant="bodySmall" style={styles.meta}>
                  {describeCadence(instance.chores.cadence_type, instance.chores.cadence_config)}
                </Text>
              </View>
              {completed && instance.photo_path ? (
                <InstanceThumbnail photoPath={instance.photo_path} />
              ) : null}
            </Card.Content>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: {},
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  textColumn: { flex: 1 },
  meta: { opacity: 0.6, marginTop: 2 },
  strikethrough: { textDecorationLine: 'line-through', opacity: 0.6 },
  thumbnail: { width: 44, height: 44, borderRadius: 8 },
});
