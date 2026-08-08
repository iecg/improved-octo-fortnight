import { Checkbox, Card, Heading, Muted } from '@couple/ui';
import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { useSignedPhotoUrl } from '@/hooks/useSignedPhotoUrl';
import { describeCadence } from '@/lib/cadence';
import type { ChoreInstanceWithChore } from '@/hooks/useTodayInstances';

function InstanceThumbnail({ photoPath }: { photoPath: string }) {
  const { data: url } = useSignedPhotoUrl(photoPath);
  if (!url) return null;
  return <Image source={{ uri: url }} style={{ width: 44, height: 44, borderRadius: 8 }} />;
}

export function TodayChoreList({
  instances,
  onPressInstance,
}: {
  instances: ChoreInstanceWithChore[];
  onPressInstance: (instance: ChoreInstanceWithChore) => void;
}) {
  return (
    <View className="gap-3">
      {instances.map((instance) => {
        const completed = instance.status === 'completed';

        const row = (
          <View className="flex-row items-center gap-3">
            {/* Decorative: the card itself is the button, and its label already
                says which chore this is. */}
            <Checkbox checked={completed} />
            <View className="shrink grow gap-0.5">
              {completed ? (
                <Text className="text-base font-semibold text-muted line-through dark:text-muted-dark">
                  {instance.chores.title}
                </Text>
              ) : (
                <Heading>{instance.chores.title}</Heading>
              )}
              <Muted>
                {describeCadence(instance.chores.cadence_type, instance.chores.cadence_config)}
              </Muted>
            </View>
            {completed && instance.photo_path ? (
              <InstanceThumbnail photoPath={instance.photo_path} />
            ) : null}
          </View>
        );

        // A completed chore is not pressable, so it is a plain card rather than
        // a button that does nothing.
        return completed ? (
          <Card key={instance.id}>{row}</Card>
        ) : (
          <Card
            key={instance.id}
            onPress={() => onPressInstance(instance)}
            accessibilityLabel={instance.chores.title}
          >
            {row}
          </Card>
        );
      })}
    </View>
  );
}
