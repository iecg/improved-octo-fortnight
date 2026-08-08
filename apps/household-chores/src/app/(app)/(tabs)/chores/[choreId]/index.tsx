import { Body, Button, Divider, Heading, Loading, Muted, Screen, Title } from '@couple/ui';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, View } from 'react-native';

import {
  useChore,
  useChoreHistory,
  useDeactivateChore,
  type ChoreHistoryInstance,
} from '@/hooks/useChores';
import { useHousehold } from '@/hooks/useHousehold';
import { useSignedPhotoUrl } from '@/hooks/useSignedPhotoUrl';
import { describeCadence } from '@/lib/cadence';

function HistoryRow({ instance }: { instance: ChoreHistoryInstance }) {
  const { data: url } = useSignedPhotoUrl(instance.photo_path);
  const status =
    instance.status === 'completed'
      ? `Completed by ${instance.profiles?.full_name ?? 'someone'}`
      : instance.status === 'missed'
        ? 'Missed'
        : 'Pending';

  return (
    <View className="flex-row items-center justify-between gap-3 py-2">
      <View className="shrink grow gap-0.5">
        <Body>{instance.due_date}</Body>
        <Muted>{status}</Muted>
      </View>
      {url ? (
        <Image source={{ uri: url }} style={{ width: 40, height: 40, borderRadius: 8 }} />
      ) : null}
    </View>
  );
}

export default function ChoreDetailScreen() {
  const { choreId } = useLocalSearchParams<{ choreId: string }>();
  const router = useRouter();
  const { data: membership } = useHousehold();
  const { data: chore, isLoading } = useChore(choreId);
  const { data: history } = useChoreHistory(choreId);
  const deactivateChore = useDeactivateChore(membership?.household_id);

  if (isLoading || !chore) return <Loading />;

  const confirmDelete = () =>
    Alert.alert(
      'Delete this chore?',
      'This removes it from Today going forward. Past history is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deactivateChore.mutateAsync(chore.id);
            router.back();
          },
        },
      ],
    );

  const meta = `${describeCadence(chore.cadence_type, chore.cadence_config)} · ${
    chore.assignment_type === 'rotating' ? 'Rotates' : 'Fixed assignee'
  }`;

  return (
    <Screen>
      <View className="gap-1">
        <Title>{chore.title}</Title>
        <Muted>{meta}</Muted>
        {chore.description ? <Body>{chore.description}</Body> : null}
      </View>

      <View className="flex-row gap-3">
        <View className="grow basis-0">
          <Button
            label="Edit"
            variant="secondary"
            onPress={() => router.push(`/chores/${chore.id}/edit`)}
          />
        </View>
        <View className="grow basis-0">
          <Button label="Delete" variant="danger" onPress={confirmDelete} />
        </View>
      </View>

      <Divider />

      <Heading>History</Heading>
      {(history ?? []).length === 0 ? (
        <Muted>No completions yet.</Muted>
      ) : (
        (history ?? []).map((instance) => <HistoryRow key={instance.id} instance={instance} />)
      )}
    </Screen>
  );
}
