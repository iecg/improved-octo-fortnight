import { hasSeenConnectedAppsNotice, useDeviceSync } from '@couple/device';
import type { Plan } from '@couple/core';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  plans as repository,
  useEnsureCadences,
  usePlans,
  useRealtimeSync,
} from '../../src/queries';
import { getCalendarLabel } from '../../src/runtime';
import { usePairedSession } from '../../src/session';

/** Two hours' notice: enough to move something, not so much it's forgotten. */
const REMINDER_LEAD_MINUTES = 120;

export default function TabsLayout() {
  const { t } = useTranslation('app');
  const { profile, couple } = usePairedSession();
  const client = useQueryClient();

  // Once for every tab, alongside the other couple-wide side effects below.
  useRealtimeSync(couple.id);

  const plansQuery = usePlans(couple.id);

  // Whoever installed this app second never saw the pairing screen, which used
  // to be the only thing that seeded the standing rituals.
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
        /*
          No icons: labels alone keep the tab bar unremarkable in a screenshot
          or over someone's shoulder.

          Three options working together, and none of them is optional.
          Omitting `tabBarIcon` does not hide the icon — `BottomTabBar` falls
          back to `MissingIcon`, so every tab carried a filled placeholder
          triangle in the accent colour. Hiding the slot removes those, but the
          label keeps its below-the-icon position and hugs the top of the bar,
          because `tabVerticalUiKit` is `justifyContent: 'flex-start'` and
          `tabBarItemStyle` cannot reach it — `BottomTabItem` reads only `flex`
          off it. Forcing `beside-icon` switches the item to
          `tabHorizontalUiKit`, which centres on both axes; with no icon beside
          it, the label is simply centred. `marginStart` undoes the gap that
          layout leaves for the icon that is not there.
        */
        tabBarLabelPosition: 'beside-icon',
        tabBarIconStyle: { display: 'none' },
        // 15pt, not 13. The bar is already the iOS standard height —
        // `TABBAR_HEIGHT_UIKIT` 49 plus the 34pt home-indicator inset — so
        // there is nothing to reclaim there without pushing the tab below the
        // 44pt tap-target minimum. What made it look empty was a 13pt label
        // alone in a 49pt row, with no icon to fill it.
        tabBarLabelStyle: { fontSize: 15, marginStart: 0 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.today') }} />
      <Tabs.Screen name="plans" options={{ title: t('tabs.plans') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
    </Tabs>
  );
}
