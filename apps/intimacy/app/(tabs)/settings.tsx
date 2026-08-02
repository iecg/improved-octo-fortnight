/**
 * Settings.
 *
 * Language is per person and says so — changing it here does not touch what
 * the partner sees. The privacy controls are device-local for the same reason
 * in reverse: they protect this phone, and syncing them would let one partner
 * turn off the other's lock.
 */
import { ConnectedAppsCard, UnpairCard } from '@couple/auth';
import { LOCALES, kindLabelKey, type Locale } from '@couple/core';
import {
  hasCalendarAccess,
  isLockAvailable,
  isLockEnabled,
  requestCalendarAccess,
  requestNotificationPermission,
  setLockEnabled,
} from '@couple/device';
import { Body, Button, Card, Chip, Divider, Heading, Muted, Screen, Title } from '@couple/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, TextInput, View } from 'react-native';

import { useCadences, useSetCadenceEnabled } from '../../src/queries';
import { getCalendarLabel, setCalendarLabel } from '../../src/runtime';
import { usePairedSession, useSession } from '../../src/session';

export default function Settings() {
  const { t } = useTranslation(['app', 'cadence', 'common']);
  const { profile, partner, setLocale, signOut, leaveCouple } = useSession();

  const { couple } = usePairedSession();
  const cadencesQuery = useCadences(couple.id);
  const setCadenceEnabled = useSetCadenceEnabled(couple.id);

  const [lockAvailable, setLockAvailable] = useState(false);
  const [lockOn, setLockOn] = useState(false);
  const [calendarOk, setCalendarOk] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => {
    void (async () => {
      setLockAvailable(await isLockAvailable());
      setLockOn(await isLockEnabled());
      setCalendarOk(await hasCalendarAccess());
      setLabel((await getCalendarLabel()) ?? t('app:settings.calendarLabelDefault'));
    })();
  }, [t]);

  async function toggleLock(next: boolean) {
    setLockOn(next);
    await setLockEnabled(next);
  }

  async function commitLabel() {
    const trimmed = label.trim();
    if (trimmed) await setCalendarLabel(trimmed);
  }

  const partnerName = partner?.displayName ?? t('common:partner.unnamed');

  return (
    <Screen>
      <Title>{t('app:settings.title')}</Title>

      <Card>
        <View className="gap-3">
          <Heading>{t('common:language.title')}</Heading>
          <View className="flex-row gap-2">
            {LOCALES.map((code: Locale) => (
              <Chip
                key={code}
                label={t(`common:language.${code}`)}
                selected={profile?.locale === code}
                onPress={() => void setLocale(code)}
              />
            ))}
          </View>
          {/* The single most important sentence on this screen. */}
          <Muted>{t('common:language.description')}</Muted>
        </View>
      </Card>

      {/* Turning one off hides its countdown and stops its reminders. The plans
          already made under it stay. There is nothing to break by pausing —
          this is the opposite of a streak. */}
      <Card>
        <View className="gap-3">
          <Heading>{t('app:settings.cadences')}</Heading>
          {(cadencesQuery.data ?? []).map((cadence) => (
            <View key={cadence.id} className="flex-row items-center justify-between gap-3">
              <View className="shrink gap-1">
                <Body>{t(kindLabelKey(cadence.domain, cadence.kind))}</Body>
                <Muted>{t('cadence:action.pause')}</Muted>
              </View>
              <Switch
                value={cadence.enabled}
                onValueChange={(next) =>
                  setCadenceEnabled.mutate({ cadenceId: cadence.id, enabled: next })
                }
                accessibilityLabel={t(kindLabelKey(cadence.domain, cadence.kind))}
              />
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <View className="gap-4">
          <Heading>{t('app:settings.privacy')}</Heading>

          <View className="flex-row items-center justify-between gap-3">
            <View className="shrink gap-1">
              <Body>{t('app:settings.lock')}</Body>
              <Muted>
                {lockAvailable
                  ? t('app:settings.lockDescription')
                  : t('app:settings.lockUnavailable')}
              </Muted>
            </View>
            <Switch
              value={lockOn}
              disabled={!lockAvailable}
              onValueChange={(next) => void toggleLock(next)}
              accessibilityLabel={t('app:settings.lock')}
            />
          </View>

          <Divider />

          <View className="gap-2">
            <Body>{t('app:settings.calendarLabel')}</Body>
            <TextInput
              className="rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
              value={label}
              onChangeText={setLabel}
              onBlur={() => void commitLabel()}
              accessibilityLabel={t('app:settings.calendarLabel')}
            />
            <Muted>{t('app:settings.calendarLabelHint')}</Muted>
          </View>
        </View>
      </Card>

      <Card>
        <View className="gap-3">
          <Heading>{t('app:settings.calendarAccess')}</Heading>
          {calendarOk ? (
            <Muted>{t('app:settings.allowed')}</Muted>
          ) : (
            <Button
              label={t('app:settings.allow')}
              variant="secondary"
              onPress={() => void requestCalendarAccess().then(setCalendarOk)}
            />
          )}
          <Divider />
          <Heading>{t('app:settings.notificationAccess')}</Heading>
          <Button
            label={t('app:settings.allow')}
            variant="secondary"
            onPress={() => void requestNotificationPermission()}
          />
        </View>
      </Card>

      <Card>
        <View className="gap-3">
          <Heading>{t('app:settings.account')}</Heading>
          <Muted>
            {partner
              ? t('app:settings.partner', { name: partnerName })
              : t('app:settings.notPaired')}
          </Muted>
          <Button
            label={t('app:settings.signOut')}
            variant="secondary"
            onPress={() => void signOut()}
          />
        </View>
      </Card>

      {/* Same component as the other app, so the two can never disagree about
          what is shared. */}
      <ConnectedAppsCard />

      {/* One pairing across both apps, so this is the same act from either. */}
      <UnpairCard onUnpair={leaveCouple} />
    </Screen>
  );
}
