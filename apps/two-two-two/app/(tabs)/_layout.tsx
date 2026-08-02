import { kindLabelKey, type AppDomain, type Plan } from '@couple/core';
import { useDeviceSync } from '@couple/device';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { plans as repository, usePlaces, usePlans } from '../../src/queries';
import { usePairedSession } from '../../src/session';

/** Three hours: a date night is worth rearranging an evening for. */
const REMINDER_LEAD_MINUTES = 180;

export default function TabsLayout() {
  const { t } = useTranslation(['app', 'cadence']);
  const { profile, couple } = usePairedSession();
  const client = useQueryClient();
  const plansQuery = usePlans(couple.id);
  const placesQuery = usePlaces(couple.id);

  // Unlike the intimacy app, there is nothing to conceal here: the real title
  // goes in the calendar, falling back to the ritual's name.
  const calendarTitleFor = useCallback(
    (plan: Plan) => plan.title?.trim() || t(kindLabelKey(plan.domain as AppDomain, plan.kind)),
    [t],
  );

  /**
   * The address, but only for a place someone opted in.
   *
   * A title is one thing — a calendar entry saying "dinner" reveals nothing.
   * An address is "we are not at home, and here is where we are", and a
   * calendar syncs to shared computers and family views this app cannot see.
   * So this returns undefined unless the place carries `shareWithCalendar`,
   * and undefined is what `reconcileDevice` treats as "write nothing".
   */
  const calendarLocationFor = useCallback(
    (plan: Plan) => {
      const place = (placesQuery.data ?? []).find((candidate) => candidate.planId === plan.id);
      return place?.shareWithCalendar ? (plan.location ?? undefined) : undefined;
    },
    [placesQuery.data],
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
    /**
     * Paused while places are in flight, not merely while they first load.
     *
     * Booking a plan invalidates both queries, and `calendarActions` only ever
     * writes an entry that does not exist yet — it never rewrites one. So a
     * pass that ran with the new plan but the old places would write the event
     * without the address, and nothing would ever correct it. Waiting for
     * places to settle costs one render and removes that race entirely.
     */
    enabled: !plansQuery.isLoading && !placesQuery.isFetching,
    calendarTitleFor,
    calendarLocationFor,
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
