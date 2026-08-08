import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button, Chip, ErrorText, Heading, Muted, SegmentedControl } from '@couple/ui';
import { Field } from '@couple/ui';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { CadencePicker } from '@/components/CadencePicker';
import { useHouseholdMembers } from '@/hooks/useHousehold';
import { useUpsertChore } from '@/hooks/useChores';
import { todayDateOnly } from '@/lib/cadence';
import { choreFormSchema, type ChoreFormValues } from '@/lib/validation';
import type { Chore, CadenceConfig } from '@/types';

function cadenceConfigFromChore(
  chore?: Chore,
): Pick<ChoreFormValues, 'weekdays' | 'everyNDays' | 'dayOfMonth'> {
  if (!chore) return {};
  const config = chore.cadence_config as CadenceConfig;
  if (chore.cadence_type === 'weekly_days')
    return { weekdays: (config as { weekdays: number[] }).weekdays };
  if (chore.cadence_type === 'every_n_days') return { everyNDays: (config as { n: number }).n };
  if (chore.cadence_type === 'monthly')
    return { dayOfMonth: (config as { day_of_month: number }).day_of_month };
  return {};
}

function cadenceConfigForSubmit(values: ChoreFormValues): CadenceConfig {
  switch (values.cadenceType) {
    case 'weekly_days':
      return { weekdays: values.weekdays ?? [] };
    case 'every_n_days':
      return { n: values.everyNDays ?? 1 };
    case 'monthly':
      return { day_of_month: values.dayOfMonth ?? 1 };
    default:
      return {};
  }
}

export function ChoreForm({
  householdId,
  chore,
  onSaved,
}: {
  householdId: string;
  chore?: Chore;
  onSaved: () => void;
}) {
  const { data: members } = useHouseholdMembers(householdId);
  const upsertChore = useUpsertChore(householdId);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChoreFormValues>({
    resolver: zodResolver(choreFormSchema),
    defaultValues: {
      title: chore?.title ?? '',
      description: chore?.description ?? '',
      cadenceType: chore?.cadence_type ?? 'daily',
      startDate: chore?.start_date ?? todayDateOnly(),
      assignmentType: chore?.assignment_type ?? 'rotating',
      fixedAssigneeId: chore?.fixed_assignee_id ?? undefined,
      ...cadenceConfigFromChore(chore),
    },
  });

  const onSubmit = async (values: ChoreFormValues) => {
    setSubmitError(null);
    try {
      await upsertChore.mutateAsync({
        id: chore?.id,
        household_id: householdId,
        title: values.title,
        description: values.description || null,
        cadence_type: values.cadenceType,
        cadence_config: cadenceConfigForSubmit(values),
        start_date: values.startDate,
        assignment_type: values.assignmentType,
        fixed_assignee_id: values.assignmentType === 'fixed' ? values.fixedAssigneeId : null,
      });
      onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save chore');
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-canvas dark:bg-canvas-dark"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        <Controller
          control={control}
          name="title"
          render={({ field: { onChange, onBlur, value } }) => (
            <Field
              label="Title"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.title?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="description"
          render={({ field: { onChange, onBlur, value } }) => (
            <Field
              label="Description (optional)"
              multiline
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
            />
          )}
        />

        <CadencePicker control={control} />
        {errors.weekdays ? <ErrorText>{errors.weekdays.message as string}</ErrorText> : null}

        <View className="gap-2">
          <Heading>Assigned to</Heading>
          <Controller
            control={control}
            name="assignmentType"
            render={({ field: { onChange, value } }) => (
              <SegmentedControl value={value} onChange={onChange} options={ASSIGNMENT_OPTIONS} />
            )}
          />
        </View>

        <Controller
          control={control}
          name="assignmentType"
          render={({ field: { value: assignmentType } }) =>
            assignmentType === 'fixed' ? (
              <Controller
                control={control}
                name="fixedAssigneeId"
                render={({ field: { onChange, value } }) => (
                  <View className="gap-2">
                    <View className="flex-row flex-wrap gap-2">
                      {(members ?? []).map((member) => (
                        <Chip
                          key={member.id}
                          label={member.profiles?.full_name ?? 'Household member'}
                          fill={false}
                          selected={value === member.user_id}
                          onPress={() => onChange(member.user_id)}
                        />
                      ))}
                    </View>
                    {errors.fixedAssigneeId ? (
                      <ErrorText>{errors.fixedAssigneeId.message}</ErrorText>
                    ) : null}
                  </View>
                )}
              />
            ) : (
              <Muted>Rotates through all household members, in the order they joined.</Muted>
            )
          }
        />

        {submitError ? <ErrorText>{submitError}</ErrorText> : null}

        <Button
          label={chore ? 'Save changes' : 'Create chore'}
          onPress={handleSubmit(onSubmit)}
          loading={isSubmitting}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ASSIGNMENT_OPTIONS = [
  { value: 'rotating', label: 'Rotates' },
  { value: 'fixed', label: 'Fixed person' },
] as const;
