import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { useInvalidateHousehold } from '@/hooks/useHousehold';
import { supabase } from '@/lib/supabase';
import { createHouseholdSchema, type CreateHouseholdFormValues } from '@/lib/validation';

export default function CreateHouseholdScreen() {
  const invalidateHousehold = useInvalidateHousehold();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateHouseholdFormValues>({
    resolver: zodResolver(createHouseholdSchema),
    defaultValues: { name: '' },
  });

  const onSubmit = async (values: CreateHouseholdFormValues) => {
    setSubmitError(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const { error } = await supabase.rpc('create_household', {
      p_name: values.name,
      p_timezone: timezone,
    });
    if (error) {
      setSubmitError(error.message);
      return;
    }
    // RootNavigator switches to the (app) group once this refetches.
    await invalidateHousehold();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Give your household a name. You&apos;ll get a shareable invite code once it&apos;s
            created.
          </Text>

          <Controller
            control={control}
            name="name"
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={styles.field}>
                <TextInput
                  label="Household name"
                  mode="outlined"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={!!errors.name}
                  autoFocus
                />
                <HelperText type="error" visible={!!errors.name}>
                  {errors.name?.message}
                </HelperText>
              </View>
            )}
          />

          <HelperText type="error" visible={!!submitError}>
            {submitError}
          </HelperText>

          <Button mode="contained" onPress={handleSubmit(onSubmit)} loading={isSubmitting}>
            Create household
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  container: { flex: 1, padding: 24, gap: 4 },
  subtitle: { marginBottom: 16, opacity: 0.7 },
  field: { marginBottom: 4 },
});
