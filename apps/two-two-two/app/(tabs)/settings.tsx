import { LOCALES, type Locale } from '@couple/core';
import { hasCalendarAccess, requestCalendarAccess } from '@couple/device';
import { Button, Card, Chip, Heading, Muted, Screen, Title } from '@couple/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AiKeyCard, resetPlannerInputs } from '../../src/features/date-planner/ai';
import { useSession } from '../../src/session';

export default function Settings() {
  const { t } = useTranslation(['app', 'common']);
  const { profile, partner, setLocale, signOut } = useSession();
  const [calendarOk, setCalendarOk] = useState(false);

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
    </Screen>
  );
}
