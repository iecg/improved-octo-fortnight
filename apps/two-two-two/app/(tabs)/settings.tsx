import { ConnectedAppsCard } from '@couple/auth';
import { LOCALES, type Locale } from '@couple/core';
import {
  hasCalendarAccess,
  isCrossAppBusyEnabled,
  requestCalendarAccess,
  setCrossAppBusyEnabled,
} from '@couple/device';
import { Button, Card, Chip, Divider, Heading, Muted, Screen, Title } from '@couple/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, View } from 'react-native';

import { AiKeyCard } from '../../src/features/date-planner/ai';
import { useSession } from '../../src/session';

export default function Settings() {
  const { t } = useTranslation(['app', 'common']);
  const { profile, partner, setLocale, signOut } = useSession();
  const [calendarOk, setCalendarOk] = useState(false);
  const [crossAppBusy, setCrossAppBusy] = useState(false);

  useEffect(() => {
    void hasCalendarAccess().then(setCalendarOk);
    void isCrossAppBusyEnabled().then(setCrossAppBusy);
  }, []);

  // Device-local, like the app lock in the other app: it decides what this
  // phone shows, so syncing it would let one partner answer for the other.
  async function toggleCrossAppBusy(next: boolean) {
    setCrossAppBusy(next);
    await setCrossAppBusyEnabled(next);
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
            <Switch
              value={crossAppBusy}
              onValueChange={(next) => void toggleCrossAppBusy(next)}
              accessibilityLabel={t('app:settings.crossAppBusy')}
            />
          </View>
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
            onPress={() => void signOut()}
          />
        </View>
      </Card>

      {/* Same component as the other app, so the two can never disagree about
          what is shared. */}
      <ConnectedAppsCard />
    </Screen>
  );
}
