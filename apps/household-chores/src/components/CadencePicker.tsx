import { Chip, Field, Heading, Muted, SegmentedControl } from '@couple/ui';
import { Controller, type Control } from 'react-hook-form';
import { View } from 'react-native';

import { WEEKDAY_LABELS } from '@/types';
import type { ChoreFormValues } from '@/lib/validation';

const CADENCE_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly_days', label: 'Weekdays' },
  { value: 'every_n_days', label: 'Every N days' },
  { value: 'monthly', label: 'Monthly' },
] as const;

export function CadencePicker({ control }: { control: Control<ChoreFormValues> }) {
  return (
    <View className="gap-2">
      <Heading>Repeats</Heading>

      <Controller
        control={control}
        name="cadenceType"
        render={({ field: { onChange, value } }) => (
          <SegmentedControl options={CADENCE_OPTIONS} value={value} onChange={onChange} />
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
                        : [...selected, day].sort(),
                    );
                  return (
                    <View className="flex-row flex-wrap gap-2">
                      {WEEKDAY_LABELS.map((label, day) => (
                        <Chip
                          key={day}
                          label={label}
                          // Pick-any, so checkbox rather than radio — and sized
                          // to its own text so one long day does not stretch
                          // the rest of the grid.
                          role="checkbox"
                          fill={false}
                          selected={selected.includes(day)}
                          onPress={() => toggle(day)}
                        />
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
                  <Field
                    label="Every how many days?"
                    keyboardType="number-pad"
                    value={value ? String(value) : ''}
                    onChangeText={(text) =>
                      onChange(Number(text.replace(/[^0-9]/g, '')) || undefined)
                    }
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
                  <Field
                    label="Day of the month (1-31)"
                    keyboardType="number-pad"
                    value={value ? String(value) : ''}
                    onChangeText={(text) =>
                      onChange(Number(text.replace(/[^0-9]/g, '')) || undefined)
                    }
                  />
                )}
              />
            );
          }

          return <></>;
        }}
      />

      <Muted>{CADENCE_HELPER_TEXT}</Muted>
    </View>
  );
}

const CADENCE_HELPER_TEXT =
  'Every N days also covers custom intervals — e.g. every 3 days for watering plants.';
