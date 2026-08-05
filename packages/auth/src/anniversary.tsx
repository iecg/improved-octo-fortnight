/**
 * The couple's anniversary.
 *
 * Shared, like sign-in and unpairing, because it is one couple-level date read
 * the same by both apps — copying it into each app is the first step to the two
 * disagreeing about it. Couple data, so it takes its value and its writer as
 * props: the settings screen holds the session and passes `onSet` down, the
 * same shape `UnpairCard` uses.
 *
 * A plain calendar date, not an instant: it is stored and shown as the day the
 * couple picked, with no timezone able to shift it. The "days until" line is
 * the one bit of arithmetic, and it lives in the pure cadence engine against
 * the couple's timezone so both partners read the same count.
 */
import { nextAnniversaryDays } from '@couple/cadence';
import { formatDay } from '@couple/i18n';
import { Body, Button, Card, Heading, Muted } from '@couple/ui';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/** The picked wall date, verbatim — never through a timezone that could shift it. */
function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function AnniversaryCard({
  anniversaryDate,
  timeZone,
  onSet,
}: {
  anniversaryDate: string | null;
  timeZone: string;
  onSet: (date: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation(['auth']);
  const locale = i18n.language === 'es' ? 'es' : 'en';
  const now = useMemo(() => new Date(), []);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState(false);

  // Noon UTC so formatting the pure calendar date in UTC can never land on the
  // day before. The picker instead wants a local date, built from the parts.
  const [py = 1970, pm = 1, pd = 1] = anniversaryDate ? anniversaryDate.split('-').map(Number) : [];
  const display = anniversaryDate ? new Date(`${anniversaryDate}T12:00:00Z`) : null;
  const pickerValue = anniversaryDate ? new Date(py, pm - 1, pd) : now;
  const days = anniversaryDate ? nextAnniversaryDays(anniversaryDate, now, timeZone) : null;

  async function choose(date: Date) {
    setPicking(false);
    setPending(true);
    try {
      await onSet(toDateString(date));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <View className="gap-3">
        <Heading>{t('auth:anniversary.title')}</Heading>
        {display ? (
          <>
            <Body>{formatDay(display, locale, 'UTC')}</Body>
            <Muted>
              {days === 0
                ? t('auth:anniversary.today')
                : t('auth:anniversary.inDays', { count: days ?? 0 })}
            </Muted>
          </>
        ) : (
          <Muted>{t('auth:anniversary.none')}</Muted>
        )}
        <Button
          label={display ? t('auth:anniversary.changeAction') : t('auth:anniversary.setAction')}
          variant="secondary"
          loading={pending}
          onPress={() => setPicking(true)}
        />
        {picking ? (
          <DateTimePicker
            value={pickerValue}
            mode="date"
            onValueChange={(_event, date) => void choose(date)}
            onDismiss={() => setPicking(false)}
          />
        ) : null}
      </View>
    </Card>
  );
}
