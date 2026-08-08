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
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
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
          /* The extra bottom padding is for the footer's sake: without it the
             last card ends flush against the footer's top border, which reads
             as content sliced off rather than content that has finished. */
          contentContainerClassName={footer ? 'grow pb-4' : 'grow'}
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

/**
 * What a button that cannot be pressed looks like — and it is deliberately not
 * "the same button, fainter".
 *
 * A primary at 50% opacity is still a filled, coloured, button-shaped thing;
 * tapping it and getting nothing is the single clearest way to look broken. A
 * disabled control should read as an outline waiting to be filled in, so it
 * drops the fill entirely and keeps only the shape.
 */
const BUTTON_DISABLED = {
  container: 'border border-line bg-transparent dark:border-line-dark',
  label: 'text-muted dark:text-muted-dark',
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
  const inactive = disabled || loading;
  // Loading keeps its own look: it is mid-press, not unavailable.
  const styles = disabled && !loading ? BUTTON_DISABLED : BUTTON_STYLES[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      className={`min-h-12 items-center justify-center rounded-xl px-4 py-3 ${styles.container} ${
        loading ? 'opacity-50' : ''
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
  role = 'radio',
}: {
  label: string;
  selected?: boolean;
  busy?: boolean;
  /**
   * Share the row equally (`grow basis-0`), which is what a segmented row of
   * choices wants. False for anything in a `flex-wrap`: a grid of weekdays or
   * household members should be as wide as its own text, or "Wednesday" drags
   * every other day out to match it.
   */
  fill?: boolean;
  accessibilityLabel?: string;
  onPress?: () => void;
  /**
   * `radio` for pick-one rows, `checkbox` for pick-any grids.
   *
   * Not cosmetic: a screen reader announces how many choices are allowed, so a
   * multi-select grid of radios tells the user something false about the form.
   */
  role?: 'radio' | 'checkbox';
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
      /*
        `justify-center` is not decoration. Flex rows stretch their children to
        the tallest, so one option wrapping to two lines makes every sibling
        that tall — and without this their labels stay pinned to the top of a
        box twice the height of the text. "Unhurried time" wrapping was enough
        to misalign the whole row, and Spanish runs ~20% longer, so the wrapping
        case is the common one rather than the exception.

        `min-h-12` is the 48dp target, which matters most for the short labels —
        a weekday chip is three characters and would otherwise be nowhere near it.
      */
      className={`min-h-12 items-center justify-center rounded-xl border px-3 py-3 ${
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
  const clamped = Math.min(1, Math.max(0, progress));
  const exact = Math.round(clamped * 100);
  /*
   * A floor, so a clock at the start of its interval never renders as an empty
   * track — an empty bar reads as broken or still loading rather than as a
   * clock that has only just been wound.
   *
   * Unconditional, including at exactly zero. Exempting true zero was the first
   * attempt and it looked worse than the bug: a ritual completed today sat at
   * 0% with a blank bar, directly above two that had a visible sliver because
   * two days of a two-year interval still rounds above nothing. The one that
   * had just been done looked like the broken one.
   *
   * The value a screen reader hears stays exact — the floor is about the pixel,
   * not the number.
   */
  const percent = Math.max(exact, 2);

  return (
    <View className="gap-1.5">
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: exact }}
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
 * The "there is more this way" mark.
 *
 * Two rotated borders rather than an icon, because this file may hold no
 * strings and the repo ships no icon set. Decorative by construction: every
 * caller is a control that already carries its own label, and a screen reader
 * announcing "chevron" after it would be noise.
 */
export function Chevron({ direction = 'right' }: { direction?: 'right' | 'down' }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      className={`h-2.5 w-2.5 border-b-2 border-r-2 border-muted dark:border-muted-dark ${
        direction === 'down' ? 'rotate-45' : '-rotate-45'
      }`}
    />
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
      {/*
        Carries `Card`'s own surface, and that is the point rather than polish.
        These headings sit between cards — on Settings they *are* the screen —
        and as bare text on the canvas they read as weaker than the content they
        contain, which inverts the hierarchy: the navigation looked like a
        caption and the caption looked like a control.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((was) => !was)}
        className="min-h-12 flex-row items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark"
      >
        <Heading>{label}</Heading>
        <Chevron direction={open ? 'down' : 'right'} />
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
