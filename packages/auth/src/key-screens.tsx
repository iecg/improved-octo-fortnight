/**
 * The two screens the key exchange needs, shared by both apps for the same
 * reason sign-in and pairing are: there is one couple key, and a second copy of
 * this flow would be a second protocol.
 *
 * Neither screen decides anything. `keys.ts` holds every decision so it can be
 * tested without React; `invite.tsx` holds the parts these share with the
 * pairing screen; these render the result and collect one tap.
 */
import { Body, Button, Card, Heading, Loading, Muted, Screen, Title } from '@couple/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { DeviceApprovalList, useDeviceApproval, useKeyWatch } from './invite';
import type { KeyService, PendingDevice } from './keys';
import { CODE_CLASS } from './style';

/**
 * Where a paired device with no key waits.
 *
 * It is not a dead end and must not feel like one: the device publishes its
 * public key on arrival, then watches for the wrap. Almost everything the user
 * can do here happens on the other phone — or in the other app on this one. The
 * exception is the mismatch path, which is deliberately on *this* side, because
 * this is the device whose identity can actually be changed.
 */
export function UnlockScreen({
  keys,
  coupleId,
  profileId,
  onUnlocked,
  onStuck,
}: {
  keys: KeyService;
  coupleId: string;
  profileId: string;
  onUnlocked: () => Promise<void>;
  /**
   * Where "I can't get in" goes.
   *
   * Kept off this screen deliberately. Two of the three things behind it —
   * a recovery code, and unpairing — are last resorts, and a last resort next
   * to the thing you should actually be doing is an invitation to take it.
   */
  onStuck: () => void;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [numbers, setNumbers] = useState<PendingDevice[] | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [askedAboutMismatch, setAskedAboutMismatch] = useState(false);
  const [resetting, setResetting] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const attempt = useCallback(async () => {
    try {
      // Publishing is idempotent, and doing it on every pass rather than once
      // means a device whose row was revoked reappears on its own.
      await keys.ensureDeviceKey(profileId);

      if ((await keys.tryAdoptWrap(coupleId, profileId)) === 'ready') {
        if (alive.current) await onUnlocked();
        return;
      }

      // One number per device that could approve this one. Usually exactly
      // one; more only when a partner has several phones, in which case the
      // person approving is looking at one of these and the reader needs to
      // find it. Computed without the couple key — see `visibleDevices`.
      const candidates = await keys.visibleDevices(coupleId, profileId);
      if (alive.current) setNumbers(candidates);
    } catch {
      if (alive.current) setErrorKey('common:state.error');
    }
  }, [keys, coupleId, profileId, onUnlocked]);

  useKeyWatch(keys, coupleId, attempt);

  const reset = useCallback(async () => {
    setResetting(true);
    setErrorKey(null);
    try {
      await keys.resetDeviceKey(profileId);
      await attempt();
    } catch {
      if (alive.current) setErrorKey('common:state.error');
    } finally {
      if (alive.current) setResetting(false);
    }
  }, [keys, profileId, attempt]);

  return (
    <Screen>
      <View className="flex-1 justify-center gap-6">
        <View className="gap-2">
          <Title>{t('auth:keys.unlock.title')}</Title>
          <Muted>{t('auth:keys.unlock.subtitle')}</Muted>
        </View>

        <Card>
          <View className="gap-3">
            <Heading>{t('auth:keys.unlock.waiting')}</Heading>
            <Muted>{t('auth:keys.unlock.hint')}</Muted>
            {numbers === null ? <Loading /> : null}
            {numbers?.map((candidate) => (
              <Text key={candidate.deviceKeyId} selectable className={CODE_CLASS}>
                {candidate.safetyNumber}
              </Text>
            ))}
            {numbers?.length === 0 ? <Muted>{t('auth:keys.unlock.noPartnerYet')}</Muted> : null}

            {numbers && numbers.length > 0 && !askedAboutMismatch ? (
              <Button
                label={t('auth:keys.unlock.mismatchAction')}
                variant="ghost"
                onPress={() => setAskedAboutMismatch(true)}
              />
            ) : null}

            {askedAboutMismatch ? (
              <View className="gap-3">
                <Muted>{t('auth:keys.unlock.mismatchHelp')}</Muted>
                {/*
                  The only action in this flow that changes anything, and it is
                  here rather than on the approving side because this is the
                  device that owns the identity in question. Republishing would
                  be theatre — the number is a function of the keypair, so the
                  same keypair reads out the same characters however often it is
                  announced.
                */}
                <Button
                  label={t('auth:keys.unlock.reset')}
                  variant="secondary"
                  loading={resetting}
                  onPress={() => void reset()}
                />
              </View>
            ) : null}
          </View>
        </Card>

        <Button label={t('auth:keys.unlock.stuck')} variant="ghost" onPress={onStuck} />

        {errorKey ? (
          <Card>
            <Body>{t(errorKey)}</Body>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

/**
 * Where a device that holds the key lets another one in.
 *
 * Reachable from the tabs, and *only* from a device that already has the key —
 * gating the approver behind an approval is the deadlock this screen exists to
 * break. The list itself is `invite.tsx`'s, because the pairing screen shows
 * exactly the same thing at the moment a partner arrives.
 */
export function ApproveScreen({
  keys,
  coupleId,
  profileId,
  onDone,
}: {
  keys: KeyService;
  coupleId: string;
  profileId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const approval = useDeviceApproval(keys, coupleId, profileId);

  return (
    <Screen>
      <View className="gap-6">
        <View className="gap-2">
          <Title>{t('auth:keys.approve.title')}</Title>
          <Muted>{t('auth:keys.approve.subtitle')}</Muted>
        </View>

        {approval.devices === null ? <Loading /> : null}

        {/* Suppressed once something has been dismissed: that device is still
            out there, and "no device is waiting" would read as an all-clear. */}
        {approval.devices?.length === 0 && !approval.dismissedAny ? (
          <Card>
            <Body>{t('auth:keys.approve.none')}</Body>
          </Card>
        ) : null}

        <DeviceApprovalList approval={approval} />

        <Button label={t('common:action.done')} variant="ghost" onPress={onDone} />
      </View>
    </Screen>
  );
}
