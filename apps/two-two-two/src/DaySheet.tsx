/**
 * A calendar day, asked for in a sheet of our own.
 *
 * Ours because iOS has no modal date picker: the native control is an inline
 * view, and mounting one on demand in a flex row lays it out at 0x0 —
 * invisible, absent from the accessibility tree, and indistinguishable from a
 * dead button. Inside a container we size, `inline` is the full calendar and
 * behaves.
 *
 * It lives here rather than in `packages/ui` because it imports a native
 * module, and `packages/ui` deliberately imports none.
 *
 * The picker answers with a wall-clock local date and only the calendar day it
 * names is ever used — booking reapplies the chosen hour in the couple's
 * timezone, and moving a plan shifts by whole days.
 */
import { Button } from '@couple/ui';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable } from 'react-native';

export function DaySheet({
  visible,
  value,
  minimumDate,
  label,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: Date;
  minimumDate?: Date;
  /** What the calendar announces itself as; each caller asks a different question. */
  label: string;
  onChange: (day: Date) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['common']);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        // Done, not cancel: dismissing keeps whatever the calendar is showing,
        // exactly as the button does. It said "Cancel" while the only caller
        // held its own state and nothing was lost either way — with a caller
        // that writes on close, the label would have been describing an undo
        // that does not happen.
        accessibilityLabel={t('common:action.done')}
        className="flex-1 justify-end bg-black/40"
        onPress={onClose}
      >
        {/* Swallows the press so tapping the sheet does not dismiss it. */}
        <Pressable
          className="gap-3 rounded-t-2xl bg-canvas px-5 pb-8 pt-4 dark:bg-canvas-dark"
          onPress={() => undefined}
        >
          <DateTimePicker
            value={value}
            mode="date"
            display="inline"
            minimumDate={minimumDate}
            accessibilityLabel={label}
            // Explicitly sized for the same reason the compact one was: the
            // native view reports no intrinsic size to Yoga.
            style={{ height: 360 }}
            onValueChange={(_event, picked) => onChange(picked)}
          />
          <Button label={t('common:action.done')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
