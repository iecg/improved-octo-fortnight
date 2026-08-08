/**
 * Settings.
 *
 * Language is per person and says so — changing it here does not touch what
 * the partner sees. The privacy controls are device-local for the same reason
 * in reverse: they protect this phone, and syncing them would let one partner
 * turn off the other's lock.
 */
import {
  AnniversaryCard,
  ConnectedAppsCard,
  DeviceListCard,
  DisplayNameCard,
  InvitePanel,
  RecoveryCodeCard,
  UnpairCard,
} from '@couple/auth';
import { LOCALES, kindLabelKey, type Locale } from '@couple/core';
import {
  hasCalendarAccess,
  isLockAvailable,
  isLockEnabled,
  requestCalendarAccess,
  requestNotificationPermission,
  setLockEnabled,
} from '@couple/device';
import {
  Body,
  Button,
  Card,
  Chip,
  Disclosure,
  Divider,
  Heading,
  Muted,
  Screen,
  Title,
} from '@couple/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, TextInput, View } from 'react-native';

import { useCadences, useSetCadenceEnabled } from '../../src/queries';
import { getCalendarLabel, keyService, setCalendarLabel } from '../../src/runtime';
import { usePairedSession, useSession } from '../../src/session';

export default function Settings() {
  const { t } = useTranslation(['app', 'cadence', 'common', 'auth']);
  const {
    profile,
    partner,
    session,
    setDisplayName,
    setLocale,
    setAnniversary,
    signOut,
    leaveCouple,
  } = useSession();
  const router = useRouter();

  // `usePairedSession` asserts the couple *and* the key. This tab is only
  // reachable with both, and the cards below assume it.
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
    <Screen tabbed>
      <Title>{t('common:settings.title')}</Title>

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

      {/*
        Above every group and never inside one, because it is the only thing on
        this screen that can be urgent: a device is waiting to be let in, and a
        partner who has to hunt for the approval behind a closed heading is a
        partner who cannot read their own plans. It renders `null` once there is
        a partner and nothing is waiting, which is almost always — so keeping it
        here costs no rows in the ordinary case.

        The invite code lives here too, in the one place you can always get back
        to. Before this it was visible on exactly one screen, the one the router
        replaces the moment you leave it.
      */}
      {session ? (
        <InvitePanel
          keys={keyService}
          coupleId={couple.id}
          profileId={session.user.id}
          code={partner ? null : couple.inviteCode}
        />
      ) : null}

      {/*
        Closed, like every other group. Open it held the partner line, sign out,
        the name field and the anniversary — some five hundred points of it —
        which pushed the four headings below it off the screen entirely. A
        settings screen whose own index does not fit is the problem this pass
        exists to fix, so nothing here defaults open except the language card.
      */}
      <Disclosure label={t('common:settings.account')}>
        <View className="gap-4">
          <Card>
            <View className="gap-3">
              <Muted>
                {partner
                  ? t('common:settings.partner', { name: partnerName })
                  : t('common:settings.notPaired')}
              </Muted>
              <Button
                label={t('common:settings.signOut')}
                variant="secondary"
                onPress={() => void signOut()}
              />
            </View>
          </Card>

          <DisplayNameCard displayName={profile?.displayName ?? null} onSave={setDisplayName} />

          {/* Couple-level and shared, so the same card serves both apps. Beside
              the display name rather than among the key cards below: both are
              things the two of you agree on, where those are about this device. */}
          <AnniversaryCard
            anniversaryDate={couple.anniversaryDate}
            timeZone={couple.timezone}
            onSet={setAnniversary}
          />
        </View>
      </Disclosure>

      {/* Turning one off hides its countdown and stops its reminders. The plans
          already made under it stay. There is nothing to break by pausing —
          this is the opposite of a streak. */}
      <Disclosure label={t('common:settings.cadences')}>
        <Card>
          <View className="gap-3">
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
      </Disclosure>

      <Disclosure label={t('app:settings.privacy')}>
        <Card>
          <View className="gap-4">
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
      </Disclosure>

      <Disclosure label={t('common:settings.permissions')}>
        <Card>
          <View className="gap-3">
            <Heading>{t('common:settings.calendarAccess')}</Heading>
            {calendarOk ? (
              <Muted>{t('common:settings.allowed')}</Muted>
            ) : (
              <Button
                label={t('common:settings.allow')}
                variant="secondary"
                onPress={() => void requestCalendarAccess().then(setCalendarOk)}
              />
            )}
            <Divider />
            <Heading>{t('common:settings.notificationAccess')}</Heading>
            <Button
              label={t('common:settings.allow')}
              variant="secondary"
              onPress={() => void requestNotificationPermission()}
            />
          </View>
        </Card>
      </Disclosure>

      {/*
        Everything about which devices can read this couple's rows. All of it
        needs the couple key — one card seals it, another reports who holds it —
        and this tab is only reachable with it. The router is what makes that
        true; `usePairedSession` is what makes it loud if it ever stops being.
      */}
      {session ? (
        <Disclosure label={t('common:settings.keys')}>
          <View className="gap-4">
            <Card>
              <Button
                label={t('auth:keys.approve.entry')}
                variant="secondary"
                onPress={() => router.push('/approve')}
              />
            </Card>
            <RecoveryCodeCard keys={keyService} coupleId={couple.id} profileId={session.user.id} />
            <DeviceListCard keys={keyService} coupleId={couple.id} profileId={session.user.id} />
            {/* Same component as the other app, so the two can never disagree
                about what is shared. */}
            <ConnectedAppsCard />
          </View>
        </Disclosure>
      ) : null}

      {/* Left in the open at the bottom, deliberately. It is the most permanent
          control here and it takes both people; something you might reach for in
          a bad moment should not also be something you have to hunt for.
          `leaveCouple` forgets the couple key on the way out. */}
      <UnpairCard onUnpair={leaveCouple} />
    </Screen>
  );
}
