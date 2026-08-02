import { ConnectedAppsCard } from '@couple/auth';
import { LOCALES, type Locale } from '@couple/core';
import { hasCalendarAccess, requestCalendarAccess } from '@couple/device';
import { Button, Card, Chip, Heading, Muted, Screen, Title } from '@couple/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useSession } from '../../src/session';

export default function Settings() {
  const { t } = useTranslation(['app', 'common']);
  const { profile, partner, setLocale, signOut } = useSession();
  const [calendarOk, setCalendarOk] = useState(false);

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
    </Screen>
  );
}
