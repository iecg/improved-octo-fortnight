import { kindLabelKey, type AppDomain, type Plan } from '@couple/core';
import { hasSeenConnectedAppsNotice, useDeviceSync } from '@couple/device';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  plans as repository,
  useEnsureCadences,
  usePlans,
  useRealtimeSync,
} from '../../src/queries';
import { usePairedSession } from '../../src/session';

/** Three hours: a date night is worth rearranging an evening for. */
const REMINDER_LEAD_MINUTES = 180;

export default function TabsLayout() {
  const { t } = useTranslation(['app', 'cadence']);
  const { profile, couple } = usePairedSession();
  const client = useQueryClient();

  // Once for every tab, alongside the other couple-wide side effect below.
  useRealtimeSync(couple.id);

  const plansQuery = usePlans(couple.id);

  // Whoever installed this app second never saw the pairing screen, which used
  // to be the only thing that seeded the three clocks.
  useEnsureCadences(couple.id);

  // Explain the shared account once. Reaching the tabs is the right moment:
  // the couple exists by now, so the notice describes something true rather
  // than something about to happen.
  const router = useRouter();
  useEffect(() => {
    void hasSeenConnectedAppsNotice().then((seen) => {
      if (!seen) router.push('/connected');
    });
  }, [router]);

  // Unlike the intimacy app, there is nothing to conceal here: the real title
  // goes in the calendar, falling back to the ritual's name.
  const calendarTitleFor = useCallback(
    (plan: Plan) => plan.title?.trim() || t(kindLabelKey(plan.domain as AppDomain, plan.kind)),
    [t],
  );

  const reminder = useMemo(
    () => ({
      leadMinutes: REMINDER_LEAD_MINUTES,
      title: t('app:notification.title'),
      body: t('app:notification.body'),
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
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#9C5B4E' }}>
      <Tabs.Screen name="index" options={{ title: t('app:tabs.today') }} />
      <Tabs.Screen name="plans" options={{ title: t('app:tabs.plans') }} />
      <Tabs.Screen name="ideas" options={{ title: t('app:tabs.ideas') }} />
      <Tabs.Screen name="settings" options={{ title: t('app:tabs.settings') }} />
    </Tabs>
  );
}
