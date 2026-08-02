import { ConnectedAppsCard, UnpairCard } from '@couple/auth';
import { LOCALES, kindLabelKey, type Locale } from '@couple/core';
import {
  hasCalendarAccess,
  requestCalendarAccess,
  requestNotificationPermission,
} from '@couple/device';
import { Button, Card, Chip, Divider, Heading, Muted, Screen, Title } from '@couple/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, View } from 'react-native';

import { AiKeyCard, resetPlannerInputs } from '../../src/features/date-planner/ai';
import {
  useCadences,
  useCrossAppBusyEnabled,
  useSetCadenceEnabled,
  useSetCrossAppBusyEnabled,
} from '../../src/queries';
import { usePairedSession, useSession } from '../../src/session';

export default function Settings() {
  const { t } = useTranslation(['app', 'cadence', 'common']);
  const { profile, partner, setLocale, signOut, leaveCouple } = useSession();
  const { couple } = usePairedSession();
  const [calendarOk, setCalendarOk] = useState(false);

  // Read through the query layer so the switch and the propose screen cannot
  // disagree about what this device has been asked for.
  const crossAppBusy = useCrossAppBusyEnabled();
  const setCrossAppBusy = useSetCrossAppBusyEnabled();

  const cadencesQuery = useCadences(couple.id);
  const setCadenceEnabled = useSetCadenceEnabled(couple.id);

  /**
   * The planner's form fields outlive every screen that fills them, so they
   * have to be emptied here rather than by unmounting anything. Signing out
   * should not leave the next person holding the last one's city.
   */
  async function leave() {
    resetPlannerInputs();
    await signOut();
  }

  useEffect(() => {
    void hasCalendarAccess().then(setCalendarOk);
  }, []);

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
          {/* Per person, not per couple — the same sentence as the other app,
              from the same shared namespace. */}
          <Muted>{t('common:language.description')}</Muted>
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
          {/* Off until asked for. Reading the phone's own calendar needs no
              switch — those events are already in the stock Calendar app — but
              this shows occupied windows even where calendar access was
              refused, and this is the app you would hand to a friend. */}
          <View className="flex-row items-center justify-between gap-3">
            <View className="shrink gap-1">
              <Heading>{t('app:settings.crossAppBusy')}</Heading>
              <Muted>{t('app:settings.crossAppBusyHint')}</Muted>
            </View>
            {/* Device-local, like the app lock in the other app: it decides
                what this phone shows, so syncing it would let one partner
                answer for the other. */}
            <Switch
              value={crossAppBusy.data}
              onValueChange={(next) => setCrossAppBusy.mutate(next)}
              accessibilityLabel={t('app:settings.crossAppBusy')}
            />
          </View>
          <Divider />
          {/* Reminders are composed on this device, in this reader's language,
              and say only that something is booked — same as the other app. */}
          <Heading>{t('app:settings.notificationAccess')}</Heading>
          <Button
            label={t('app:settings.allow')}
            variant="secondary"
            onPress={() => void requestNotificationPermission()}
          />
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
                <Heading>{t(kindLabelKey(cadence.domain, cadence.kind))}</Heading>
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

      {/* Optional, and per person: a key lives on one phone and is never shared. */}
      <AiKeyCard />

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
            onPress={() => void leave()}
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
