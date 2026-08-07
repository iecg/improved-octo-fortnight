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
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({
  children,
  scroll = true,
  tabbed = false,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  /**
   * This screen sits inside the tab navigator, so the bottom inset is already
   * spent and claiming it here would spend it twice.
   *
   * React Navigation lays the scene container and the tab bar as siblings in a
   * column flex, and `getTabBarHeight` is `TABBAR_HEIGHT_UIKIT + inset` — the
   * scene already stops above the home indicator. Nothing hands the scene a
   * reduced inset: bottom tabs gives them to the tab bar alone, and only
   * `StackView` re-provides them. So a second `'bottom'` edge here adds ~34pt
   * of dead strip, and the scene's `overflow: 'hidden'` clips the content into
   * it rather than letting it scroll.
   *
   * A prop rather than a context read, because no shared package imports
   * `expo-router` and reaching `BottomTabBarHeightContext` would be the first
   * one to. `tests/guards/screen-insets.test.ts` is what stops it being
   * forgotten on the next tab screen.
   */
  tabbed?: boolean;
  /**
   * Pinned below the scroll area: the screen's primary action, and whatever
   * one line explains what it will do.
   *
   * Outside the `ScrollView` on purpose. A button at the bottom of a long form
   * is a button most people never reach — the propose sheet's submit sat at
   * y≈990 on an 874pt screen and read as dead.
   */
  footer?: ReactNode;
}) {
  const body = <View className="flex-1 gap-4 px-5 py-4">{children}</View>;
  return (
    <SafeAreaView
      className="flex-1 bg-canvas dark:bg-canvas-dark"
      edges={tabbed ? ['top'] : ['top', 'bottom']}
    >
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
      {footer ? (
        <View className="gap-2 border-t border-line bg-canvas px-5 py-3 dark:border-line-dark dark:bg-canvas-dark">
          {footer}
        </View>
      ) : null}
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
 *
 * `fill` is the difference between one row and a wrapping list, and getting it
 * wrong is not subtle. Filling means `grow basis-0`: every chip the same width,
 * the row exactly full, which is what a fixed set of three or four options
 * wants. In a `flex-wrap` list it destroys the chips. Yoga does not implement
 * CSS's automatic minimum size — `min-width: auto` never resolves to
 * min-content — so with a zero basis each chip shrinks *past* its own text
 * instead of stopping at it. Fourteen day chips came out ~13pt wide with
 * `Aug 16, 2026` wrapped to one character per line, rendering as dotted
 * vertical bars, while the three that wrapped to a second row looked perfect.
 * Anything that wraps must pass `fill={false}` and be sized by its text.
 */
export function Chip({
  label,
  selected = false,
  busy = false,
  fill = true,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  selected?: boolean;
  busy?: boolean;
  /** Share the row equally with its siblings. False for anything in a `flex-wrap`. */
  fill?: boolean;
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
      className={`items-center rounded-xl border px-3 py-3 ${
        fill ? 'grow basis-0' : 'shrink-0'
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

/**
 * A section that is closed until someone wants it.
 *
 * The point is what is *not* on screen. Every optional field on a form — a
 * title, a place, a note — is one more thing to read and decide about before
 * reaching the button, and the people these apps are for are the ones that
 * costs most. Closed by default, so the screen shows what must be answered and
 * the answer to everything else is already good.
 *
 * Conditional rendering rather than height animation: nothing here needs a
 * layout animation, and an unmounted subtree keeps its inputs out of the
 * accessibility tree as well as off the screen. The chevron is two rotated
 * borders because this file may not hold strings and there is no icon set —
 * `label` carries the meaning for a screen reader either way.
 */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((was) => !was)}
        className="min-h-12 flex-row items-center justify-between gap-3 px-1"
      >
        <Heading>{label}</Heading>
        <View
          className={`h-2.5 w-2.5 border-b-2 border-r-2 border-muted dark:border-muted-dark ${
            open ? 'rotate-45' : '-rotate-45'
          }`}
        />
      </Pressable>
      {open ? children : null}
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
