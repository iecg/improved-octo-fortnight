import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';

import { CadencePicker } from '@/components/CadencePicker';
import { useHouseholdMembers } from '@/hooks/useHousehold';
import { useUpsertChore } from '@/hooks/useChores';
import { todayDateOnly } from '@/lib/cadence';
import { choreFormSchema, type ChoreFormValues } from '@/lib/validation';
import type { Chore, CadenceConfig } from '@/types';

function cadenceConfigFromChore(chore?: Chore): Pick<ChoreFormValues, 'weekdays' | 'everyNDays' | 'dayOfMonth'> {
  if (!chore) return {};
  const config = chore.cadence_config as CadenceConfig;
  if (chore.cadence_type === 'weekly_days') return { weekdays: (config as { weekdays: number[] }).weekdays };
  if (chore.cadence_type === 'every_n_days') return { everyNDays: (config as { n: number }).n };
  if (chore.cadence_type === 'monthly') return { dayOfMonth: (config as { day_of_month: number }).day_of_month };
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
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Controller
          control={control}
          name="title"
          render={({ field: { onChange, onBlur, value } }) => (
            <View style={styles.field}>
              <TextInput
                label="Title"
                mode="outlined"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={!!errors.title}
              />
              <HelperText type="error" visible={!!errors.title}>
                {errors.title?.message}
              </HelperText>
            </View>
          )}
        />

        <Controller
          control={control}
          name="description"
          render={({ field: { onChange, onBlur, value } }) => (
            <View style={styles.field}>
              <TextInput
                label="Description (optional)"
                mode="outlined"
                multiline
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
              />
            </View>
          )}
        />

        <CadencePicker control={control} />
        <HelperText type="error" visible={!!errors.weekdays}>
          {errors.weekdays?.message as string}
        </HelperText>

        <View style={styles.field}>
          <Text variant="labelLarge">Assigned to</Text>
          <Controller
            control={control}
            name="assignmentType"
            render={({ field: { onChange, value } }) => (
              <SegmentedButtons
                value={value}
                onValueChange={onChange}
                buttons={[
                  { value: 'rotating', label: 'Rotates' },
                  { value: 'fixed', label: 'Fixed person' },
                ]}
              />
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
                  <View style={styles.field}>
                    <View style={styles.chipRow}>
                      {(members ?? []).map((member) => (
                        <Chip
                          key={member.id}
                          selected={value === member.user_id}
                          onPress={() => onChange(member.user_id)}
                        >
                          {member.profiles?.full_name ?? 'Household member'}
                        </Chip>
                      ))}
                    </View>
                    <HelperText type="error" visible={!!errors.fixedAssigneeId}>
                      {errors.fixedAssigneeId?.message}
                    </HelperText>
                  </View>
                )}
              />
            ) : (
              <Text variant="bodySmall" style={styles.rotatingHint}>
                Rotates through all household members, in the order they joined.
              </Text>
            )
          }
        />

        <HelperText type="error" visible={!!submitError}>
          {submitError}
        </HelperText>

        <Button mode="contained" onPress={handleSubmit(onSubmit)} loading={isSubmitting}>
          {chore ? 'Save changes' : 'Create chore'}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 16, gap: 16 },
  field: { gap: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rotatingHint: { opacity: 0.6 },
});
