import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button, ErrorText, Field, Muted, Screen } from '@couple/ui';
import { KeyboardAvoidingView, Platform } from 'react-native';

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
    <Screen scroll={false}>
      <KeyboardAvoidingView
        className="flex-1 gap-4"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Muted>
          Give your household a name. You&apos;ll get a shareable invite code once it&apos;s
          created.
        </Muted>

        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value } }) => (
            <Field
              label="Household name"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.name?.message}
              autoFocus
            />
          )}
        />

        {submitError ? <ErrorText>{submitError}</ErrorText> : null}

        <Button label="Create household" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
