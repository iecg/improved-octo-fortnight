import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button, ErrorText, Field, Muted, Screen } from '@couple/ui';
import { KeyboardAvoidingView, Platform } from 'react-native';

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
      setSubmitError(
        error.message === 'Invalid invite code'
          ? error.message
          : 'Could not join that household. Check the code and try again.',
      );
      return;
    }
    await invalidateHousehold();
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        className="flex-1 gap-4"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Muted>Enter the 6-character invite code a housemate shared with you.</Muted>

        <Controller
          control={control}
          name="code"
          render={({ field: { onChange, onBlur, value } }) => (
            <Field
              label="Invite code"
              variant="code"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.code?.message}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              autoFocus
            />
          )}
        />

        {submitError ? <ErrorText>{submitError}</ErrorText> : null}

        <Button label="Join household" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
