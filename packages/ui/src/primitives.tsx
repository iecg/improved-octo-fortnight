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
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
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

/**
 * `onPress` makes the whole card the target rather than putting a button inside
 * it. A card that navigates is a big, obvious tap area, and splitting that into
 * a small control inside a large inert box is worse for anyone aiming.
 *
 * `accessibilityLabel` is required alongside `onPress`: a card holds several
 * pieces of text, and left to itself a screen reader reads all of them as the
 * button's name. The caller knows which one is the destination.
 */
export function Card({
  children,
  className = '',
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  className?: string;
} & (
  | { onPress?: undefined; accessibilityLabel?: never }
  | { onPress: () => void; accessibilityLabel: string }
)) {
  const style = `rounded-2xl border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark ${className}`;

  if (!onPress) return <View className={style}>{children}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={style}
    >
      {children}
    </Pressable>
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

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

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
  /**
   * Leaving a household, deleting a chore — the ones worth a second look.
   *
   * Outlined rather than filled: a destructive action should be findable, not
   * the brightest thing on the screen. Reuses `overdue` instead of introducing
   * a red, because every app already defines it and a second warm red would be
   * one more colour for each palette to keep in agreement.
   */
  danger: {
    container: 'border border-overdue bg-surface dark:border-overdue-dark dark:bg-surface-dark',
    label: 'text-overdue dark:text-overdue-dark',
  },
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
  role = 'radio',
  fill = true,
}: {
  label: string;
  selected?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  onPress?: () => void;
  /**
   * `radio` for pick-one rows, `checkbox` for pick-any grids.
   *
   * Not cosmetic: a screen reader announces how many choices are allowed, so a
   * multi-select grid of radios tells the user something false about the form.
   */
  role?: 'radio' | 'checkbox';
  /**
   * Share the row equally (`grow basis-0`), which is what a segmented row of
   * choices wants. A grid of weekdays or household members does not — those
   * should be as wide as their own text and wrap, or "Wednesday" drags every
   * other day out to match it.
   */
  fill?: boolean;
}) {
  const border = selected
    ? 'border-accent bg-accent/10 dark:border-accent-dark'
    : busy
      ? 'border-duesoon bg-surface dark:border-duesoon-dark dark:bg-surface-dark'
      : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark';

  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'checkbox' ? { checked: selected } : { selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={`min-h-12 items-center justify-center rounded-xl border px-3 py-3 ${
        fill ? 'grow basis-0' : ''
      } ${border}`}
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

/**
 * Why a form error is a component and not just `Muted` in red: it has to keep
 * its own colour token straight across both schemes, and it is the one piece of
 * text on a form that must not be mistaken for a hint.
 */
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text className="text-sm text-overdue dark:text-overdue-dark">{children}</Text>;
}

/**
 * A labelled text field.
 *
 * The label sits above the input rather than floating into the border. A
 * floating label animates out of the way of the very thing it names, is hard to
 * read at small sizes, and has to shrink — which Spanish, running ~20% longer,
 * is worst served by. Static is also simply less code to be wrong.
 *
 * `label` doubles as the accessibility name, so there is no way to render a
 * field that a screen reader announces as nothing.
 *
 * This supersedes the `INPUT_CLASS` string that callers were pasting: the
 * string could not carry the error state, the label, or the min-height, so
 * every caller decided those separately and they drifted.
 */
export function Field({
  label,
  error,
  hint,
  variant = 'default',
  multiline,
  ...input
}: {
  label: string;
  /** Pre-translated by the caller. Its presence is what marks the field invalid. */
  error?: string;
  /** Pre-translated by the caller. Hidden while `error` is showing — two lines of guidance under one input is one too many. */
  hint?: string;
  /**
   * `code` is for a value meant to be read aloud or copied — an invite code, a
   * safety number. Centred and letter-spaced, because an unbroken run of
   * characters is hard to read out accurately.
   */
  variant?: 'default' | 'code';
} & TextInputProps) {
  const border = error
    ? 'border-overdue dark:border-overdue-dark'
    : 'border-line dark:border-line-dark';

  return (
    <View className="gap-1.5">
      <Heading>{label}</Heading>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : undefined}
        placeholderTextColor="#9CA3AF"
        className={`rounded-xl border bg-surface px-4 py-3 text-base text-ink dark:bg-surface-dark dark:text-ink-dark ${border} ${
          multiline ? 'min-h-20' : 'min-h-12'
        } ${variant === 'code' ? 'text-center tracking-[6px]' : ''}`}
        {...input}
      />
      {error ? <ErrorText>{error}</ErrorText> : hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

/**
 * A row of mutually exclusive choices.
 *
 * Deliberately built from `Chip` rather than styled separately — a chip in a
 * pick-one row already *is* a segment, down to the radio semantics and the
 * equal-width sizing. Keeping them one implementation means a fix to the press
 * target or the selected contrast lands in both places at once.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  /** `label` is pre-translated by the caller. */
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/**
 * The floating "add" button.
 *
 * `accessibilityLabel` is required, not optional: this is the one control in
 * the library with no visible text, so an unlabelled one is silent to a screen
 * reader and there would be nothing on screen to guess from.
 *
 * `icon` is a node rather than a name so the icon set stays the consuming app's
 * choice — `packages/ui` does not depend on one, and the couple apps, which use
 * no icons at all, do not inherit a dependency for a button they never render.
 */
export function FAB({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full bg-accent shadow-lg dark:bg-accent-dark"
    >
      {icon}
    </Pressable>
  );
}

/**
 * Initials in a circle.
 *
 * The caller computes the initials: which characters of a name stand for it is
 * a language question, not a layout one, and this file is the wrong place to
 * guess at it.
 */
export function Avatar({ initials }: { initials: string }) {
  return (
    <View className="h-10 w-10 items-center justify-center rounded-full bg-accent dark:bg-accent-dark">
      <Text className="text-sm font-semibold text-white dark:text-canvas-dark">{initials}</Text>
    </View>
  );
}

/** U+2713. A literal would trip the no-strings-in-JSX rule this file is held to. */
const CHECK = '✓';

/**
 * A checkmark, optionally a control.
 *
 * Without `onToggle` it is decoration and hides itself from assistive tech —
 * the usual caller is a card that is already a button announcing "Wash dishes,
 * completed", and a second focus stop on the tick would only repeat that. With
 * `onToggle` it becomes a real checkbox with its own target.
 */
export function Checkbox({
  checked,
  onToggle,
  accessibilityLabel,
}: {
  checked: boolean;
  onToggle?: () => void;
  accessibilityLabel?: string;
}) {
  const box = `h-6 w-6 items-center justify-center rounded-md border ${
    checked
      ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
      : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark'
  }`;

  // A glyph rather than an icon dependency, and `Text` rather than a drawn tick
  // so it scales with the reader's font size like everything else.
  const mark = checked ? (
    <Text className="text-sm text-white dark:text-canvas-dark">{CHECK}</Text>
  ) : null;

  if (!onToggle) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={box}
      >
        {mark}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      onPress={onToggle}
      className="min-h-12 min-w-12 items-center justify-center"
    >
      <View className={box}>{mark}</View>
    </Pressable>
  );
}
