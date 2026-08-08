import { Controller, type Control } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { Chip, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';

import { WEEKDAY_LABELS } from '@/types';
import type { ChoreFormValues } from '@/lib/validation';

const CADENCE_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly_days', label: 'Weekdays' },
  { value: 'every_n_days', label: 'Every N days' },
  { value: 'monthly', label: 'Monthly' },
];

export function CadencePicker({ control }: { control: Control<ChoreFormValues> }) {
  return (
    <View style={styles.container}>
      <Text variant="labelLarge">Repeats</Text>

      <Controller
        control={control}
        name="cadenceType"
        render={({ field: { onChange, value } }) => (
          <SegmentedButtons value={value} onValueChange={onChange} buttons={CADENCE_OPTIONS} />
        )}
      />

      <Controller
        control={control}
        name="cadenceType"
        render={({ field: { value: cadenceType } }) => {
          if (cadenceType === 'weekly_days') {
            return (
              <Controller
                control={control}
                name="weekdays"
                render={({ field: { onChange, value } }) => {
                  const selected = value ?? [];
                  const toggle = (day: number) =>
                    onChange(
                      selected.includes(day)
                        ? selected.filter((d) => d !== day)
                        : [...selected, day].sort()
                    );
                  return (
                    <View style={styles.chipRow}>
                      {WEEKDAY_LABELS.map((label, day) => (
                        <Chip key={day} selected={selected.includes(day)} onPress={() => toggle(day)}>
                          {label}
                        </Chip>
                      ))}
                    </View>
                  );
                }}
              />
            );
          }

          if (cadenceType === 'every_n_days') {
            return (
              <Controller
                control={control}
                name="everyNDays"
                render={({ field: { onChange, value } }) => (
                  <TextInput
                    label="Every how many days?"
                    mode="outlined"
                    keyboardType="number-pad"
                    value={value ? String(value) : ''}
                    onChangeText={(text) => onChange(Number(text.replace(/[^0-9]/g, '')) || undefined)}
                  />
                )}
              />
            );
          }

          if (cadenceType === 'monthly') {
            return (
              <Controller
                control={control}
                name="dayOfMonth"
                render={({ field: { onChange, value } }) => (
                  <TextInput
                    label="Day of the month (1-31)"
                    mode="outlined"
                    keyboardType="number-pad"
                    value={value ? String(value) : ''}
                    onChangeText={(text) => onChange(Number(text.replace(/[^0-9]/g, '')) || undefined)}
                  />
                )}
              />
            );
          }

          return <></>;
        }}
      />

      <HelperText type="info" visible>
        {cadenceHelperText}
      </HelperText>
    </View>
  );
}

const cadenceHelperText =
  'Every N days also covers custom intervals — e.g. every 3 days for watering plants.';

const styles = StyleSheet.create({
  container: { gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
