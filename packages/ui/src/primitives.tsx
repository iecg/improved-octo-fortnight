/**
 * Shared UI primitives.
 *
 * No strings live in this file — every component takes its text as a prop or
 * child, so the lint rule banning literals in JSX has nothing to catch and no
 * component can hard-code English.
 *
 * Spanish runs roughly 20% longer than English, so anything holding text wraps
 * rather than truncating, and nothing is sized to fit a specific word.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const body = <View className="flex-1 gap-4 px-5 py-4">{children}</View>;
  return (
    <SafeAreaView className="flex-1 bg-canvas dark:bg-canvas-dark" edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView
          contentContainerClassName="grow"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <View
      className={`rounded-2xl border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark ${className}`}
    >
      {children}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-2xl font-semibold text-ink dark:text-ink-dark">{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text className="text-base font-semibold text-ink dark:text-ink-dark">{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text className="text-base text-ink dark:text-ink-dark">{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text className="text-sm text-muted dark:text-muted-dark">{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, { container: string; label: string }> = {
  primary: {
    container: 'bg-accent dark:bg-accent-dark',
    label: 'text-white dark:text-canvas-dark',
  },
  secondary: {
    container: 'border border-line bg-surface dark:border-line-dark dark:bg-surface-dark',
    label: 'text-ink dark:text-ink-dark',
  },
  ghost: { container: '', label: 'text-muted dark:text-muted-dark' },
};

export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled = false,
  ...pressable
}: {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
} & PressableProps) {
  const styles = BUTTON_STYLES[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      className={`min-h-12 items-center justify-center rounded-xl px-4 py-3 ${styles.container} ${
        inactive ? 'opacity-50' : ''
      }`}
      {...pressable}
    >
      {loading ? (
        <ActivityIndicator />
      ) : (
        <Text className={`text-center text-base font-semibold ${styles.label}`}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * A single choice in a row of them. Used for check-ins, where the options
 * carry equal weight — "not tonight" is styled exactly like "yes", because it
 * is just as valid an answer.
 *
 * `busy` marks a choice that clashes with something already booked. It is a
 * hint, never a block: the chip stays pressable, because deciding to overlap
 * is the caller's business and a disabled chip would state more certainty
 * about someone's calendar than we have. The marker is a dot rather than a
 * word so this file keeps holding no strings — `accessibilityLabel` is what
 * carries the meaning, already translated by the caller.
 */
export function Chip({
  label,
  selected = false,
  busy = false,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  selected?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  onPress?: () => void;
}) {
  const border = selected
    ? 'border-accent bg-accent/10 dark:border-accent-dark'
    : busy
      ? 'border-duesoon bg-surface dark:border-duesoon-dark dark:bg-surface-dark'
      : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark';

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={`grow basis-0 items-center rounded-xl border px-3 py-3 ${border}`}
    >
      <Text
        className={`text-center text-sm font-medium ${
          selected ? 'text-accent dark:text-accent-dark' : 'text-ink dark:text-ink-dark'
        }`}
      >
        {label}
      </Text>
      {busy ? (
        <View className="mt-1 h-1.5 w-1.5 rounded-full bg-duesoon dark:bg-duesoon-dark" />
      ) : null}
    </Pressable>
  );
}

export type Health = 'on_track' | 'due_soon' | 'overdue';

const HEALTH_BAR: Record<Health, string> = {
  on_track: 'bg-ontrack dark:bg-ontrack-dark',
  due_soon: 'bg-duesoon dark:bg-duesoon-dark',
  overdue: 'bg-overdue dark:bg-overdue-dark',
};

/**
 * Progress through a cadence interval.
 *
 * A bar rather than a ring: it needs no drawing library, and it reads at a
 * glance without implying a score. `label` is pre-translated by the caller.
 */
export function CadenceBar({
  progress,
  health,
  label,
  healthLabel,
}: {
  progress: number;
  health: Health;
  label: string;
  /**
   * The health state in words, already translated by the caller.
   *
   * Health is otherwise carried by the bar's colour alone, which says nothing
   * to a screen reader and nothing to anyone who cannot separate the three
   * colours. `healthLabelKey` in `@couple/cadence` names the key; this renders
   * what the caller made of it.
   */
  healthLabel: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <View className="gap-1.5">
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        accessibilityLabel={`${label} — ${healthLabel}`}
        className="h-2 overflow-hidden rounded-full bg-line dark:bg-line-dark"
      >
        <View
          className={`h-full rounded-full ${HEALTH_BAR[health]}`}
          style={{ width: `${percent}%` }}
        />
      </View>
      <Muted>{label}</Muted>
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View className="flex-row items-center gap-3">{children}</View>;
}

export function Divider() {
  return <View className="h-px bg-line dark:bg-line-dark" />;
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center py-10">
      <ActivityIndicator />
    </View>
  );
}
