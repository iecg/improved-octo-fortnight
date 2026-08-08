import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, HelperText, Text } from 'react-native-paper';

import { LoadingScreen } from '@/components/LoadingScreen';
import { PhotoCapture } from '@/components/PhotoCapture';
import { useHousehold } from '@/hooks/useHousehold';
import { useChoreInstance, useCompleteChoreInstance } from '@/hooks/useTodayInstances';
import { uploadChorePhoto } from '@/lib/storage';

export default function CompleteChoreScreen() {
  const { instanceId } = useLocalSearchParams<{ instanceId: string }>();
  const router = useRouter();
  const { data: membership } = useHousehold();
  const { data: instance, isLoading } = useChoreInstance(instanceId);
  const completeInstance = useCompleteChoreInstance(membership?.household_id);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !instance || !membership) return <LoadingScreen />;

  const onConfirm = async () => {
    if (!photoUri) {
      setError('Add a photo as proof first.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const photoPath = await uploadChorePhoto({
        householdId: membership.household_id,
        instanceId: instance.id,
        localUri: photoUri,
      });
      await completeInstance.mutateAsync({ instanceId: instance.id, photoPath });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save completion');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">{instance.chores.title}</Text>
      <Text variant="bodyMedium" style={styles.subtitle}>
        Take or choose a photo as proof this is done.
      </Text>

      <PhotoCapture uri={photoUri} onChange={setPhotoUri} />

      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>

      <Button mode="contained" onPress={onConfirm} loading={submitting} disabled={submitting}>
        Mark complete
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  subtitle: { opacity: 0.7 },
});
