import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { useInvalidateHousehold } from '@/hooks/useHousehold';
import { supabase } from '@/lib/supabase';
import { joinHouseholdSchema, type JoinHouseholdFormValues } from '@/lib/validation';

export default function JoinHouseholdScreen() {
  const { code: prefillCode } = useLocalSearchParams<{ code?: string }>();
  const invalidateHousehold = useInvalidateHousehold();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<JoinHouseholdFormValues>({
    resolver: zodResolver(joinHouseholdSchema),
    defaultValues: { code: prefillCode ?? '' },
  });

  const onSubmit = async (values: JoinHouseholdFormValues) => {
    setSubmitError(null);
    const { error } = await supabase.rpc('join_household_by_code', { p_code: values.code });
    if (error) {
      setSubmitError(error.message === 'Invalid invite code' ? error.message : 'Could not join that household. Check the code and try again.');
      return;
    }
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
            Enter the 6-character invite code a housemate shared with you.
          </Text>

          <Controller
            control={control}
            name="code"
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={styles.field}>
                <TextInput
                  label="Invite code"
                  mode="outlined"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={!!errors.code}
                  autoFocus
                />
                <HelperText type="error" visible={!!errors.code}>
                  {errors.code?.message}
                </HelperText>
              </View>
            )}
          />

          <HelperText type="error" visible={!!submitError}>
            {submitError}
          </HelperText>

          <Button mode="contained" onPress={handleSubmit(onSubmit)} loading={isSubmitting}>
            Join household
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
