import { useDeviceSync } from '@couple/device';
import type { Plan } from '@couple/core';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { plans as repository, usePlans } from '../../src/queries';
import { getCalendarLabel } from '../../src/runtime';
import { usePairedSession } from '../../src/session';

/** Two hours' notice: enough to move something, not so much it's forgotten. */
const REMINDER_LEAD_MINUTES = 120;

export default function TabsLayout() {
  const { t } = useTranslation('app');
  const { profile, couple } = usePairedSession();
  const client = useQueryClient();
  const plansQuery = usePlans(couple.id);

  const [calendarLabel, setCalendarLabel] = useState<string | null>(null);
  useEffect(() => {
    void getCalendarLabel().then(setCalendarLabel);
  }, []);

  // The event title is the user's chosen neutral label and nothing else — no
  // plan title, no notes, no location. The calendar is visible to anyone
  // holding an unlocked phone and syncs to a desktop.
  const calendarTitleFor = useCallback(
    () => calendarLabel ?? t('settings.calendarLabelDefault'),
    [calendarLabel, t],
  );

  // Composed here, on the recipient's own device, so each partner is reminded
  // in their own language — and so nothing about the plan reaches a push
  // service. The copy is deliberately empty of content.
  const reminder = useMemo(
    () => ({
      leadMinutes: REMINDER_LEAD_MINUTES,
      title: t('notification.title'),
      body: t('notification.body'),
    }),
    [t],
  );

  const onCalendarEvent = useCallback(
    async (plan: Plan, eventId: string | null) => {
      await repository.recordCalendarEvent(plan, profile.id, eventId);
      await client.invalidateQueries({ queryKey: ['plans'] });
    },
    [client, profile.id],
  );

  useDeviceSync({
    plans: plansQuery.data ?? [],
    profileId: profile.id,
    timeZone: couple.timezone,
    enabled: !plansQuery.isLoading,
    calendarTitleFor,
    reminder,
    onCalendarEvent,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#9C5B4E',
        // No icons: labels alone keep the tab bar unremarkable in a screenshot
        // or over someone's shoulder.
        tabBarLabelStyle: { fontSize: 13 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.today') }} />
      <Tabs.Screen name="plans" options={{ title: t('tabs.plans') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
    </Tabs>
  );
}
