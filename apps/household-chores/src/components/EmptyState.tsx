import { View } from 'react-native';
import { Heading, Muted } from '@couple/ui';

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-2 p-8">
      <Heading>{title}</Heading>
      {subtitle ? <Muted>{subtitle}</Muted> : null}
    </View>
  );
}
