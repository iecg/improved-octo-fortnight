import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, Portal, Text } from 'react-native-paper';
import { useState } from 'react';

import { LoadingScreen } from '@/components/LoadingScreen';
import { useChore, useChoreHistory, useDeactivateChore, type ChoreHistoryInstance } from '@/hooks/useChores';
import { useHousehold } from '@/hooks/useHousehold';
import { useSignedPhotoUrl } from '@/hooks/useSignedPhotoUrl';
import { describeCadence } from '@/lib/cadence';

function HistoryRow({ instance }: { instance: ChoreHistoryInstance }) {
  const { data: url } = useSignedPhotoUrl(instance.photo_path);
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyText}>
        <Text variant="bodyMedium">{instance.due_date}</Text>
        <Text variant="bodySmall" style={styles.meta}>
          {instance.status === 'completed'
            ? `Completed by ${instance.profiles?.full_name ?? 'someone'}`
            : instance.status === 'missed'
              ? 'Missed'
              : 'Pending'}
        </Text>
      </View>
      {url ? <Image source={{ uri: url }} style={styles.historyThumb} contentFit="cover" /> : null}
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading || !chore) return <LoadingScreen />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">{chore.title}</Text>
      <Text variant="bodyMedium" style={styles.meta}>
        {describeCadence(chore.cadence_type, chore.cadence_config)} ·{' '}
        {chore.assignment_type === 'rotating' ? 'Rotates' : 'Fixed assignee'}
      </Text>
      {chore.description ? <Text style={styles.description}>{chore.description}</Text> : null}

      <View style={styles.actions}>
        <Button mode="outlined" onPress={() => router.push(`/chores/${chore.id}/edit`)}>
          Edit
        </Button>
        <Button mode="outlined" textColor="#B3261E" onPress={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </View>

      <Divider style={styles.divider} />

      <Text variant="titleMedium" style={styles.historyTitle}>
        History
      </Text>
      {(history ?? []).length === 0 ? (
        <Text style={styles.meta}>No completions yet.</Text>
      ) : (
        (history ?? []).map((instance) => <HistoryRow key={instance.id} instance={instance} />)
      )}

      <Portal>
        <Dialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>Delete this chore?</Dialog.Title>
          <Dialog.Content>
            <Text>This removes it from Today going forward. Past history is kept.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              textColor="#B3261E"
              onPress={async () => {
                await deactivateChore.mutateAsync(chore.id);
                setConfirmDelete(false);
                router.back();
              }}
            >
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 4 },
  meta: { opacity: 0.6 },
  description: { marginTop: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  divider: { marginVertical: 20 },
  historyTitle: { marginBottom: 12 },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  historyText: { flex: 1 },
  historyThumb: { width: 40, height: 40, borderRadius: 8 },
});
