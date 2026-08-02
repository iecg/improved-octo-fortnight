import { InvitePanel } from '@couple/auth';
import { LOCALES, type Locale } from '@couple/core';
import { hasCalendarAccess, requestCalendarAccess } from '@couple/device';
import { Button, Card, Chip, Heading, Muted, Screen, Title } from '@couple/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { keyService } from '../../src/runtime';
import { useSession } from '../../src/session';

export default function Settings() {
  const { t } = useTranslation(['app', 'common', 'auth']);
  const { couple, partner, profile, session, setLocale, signOut } = useSession();
  const router = useRouter();
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
            label={t('auth:keys.approve.entry')}
            variant="secondary"
            onPress={() => router.push('/approve')}
          />
          <Button
            label={t('app:settings.signOut')}
            variant="secondary"
            onPress={() => void signOut()}
          />
        </View>
      </Card>

      {/* The same panel the pairing screen shows — one pairing across both apps
          means one place that explains where it stands. */}
      {session && couple ? (
        <InvitePanel
          keys={keyService}
          coupleId={couple.id}
          profileId={session.user.id}
          code={partner ? null : couple.inviteCode}
        />
      ) : null}
    </Screen>
  );
}
