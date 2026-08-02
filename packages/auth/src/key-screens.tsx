/**
 * The two screens the key exchange needs, shared by both apps for the same
 * reason sign-in and pairing are: there is one couple key, and a second copy of
 * this flow would be a second protocol.
 *
 * Neither screen decides anything. `keys.ts` holds every decision so it can be
 * tested without React; these render its output and collect one tap.
 */
import { Body, Button, Card, Heading, Loading, Muted, Screen, Title } from '@couple/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { KeyService, PendingDevice } from './keys';
import { CODE_CLASS } from './style';

/**
 * Where a paired device with no key waits.
 *
 * It is not a dead end and must not feel like one: the device publishes its
 * public key on arrival, then watches for the wrap. Everything the user can do
 * here happens on the other phone — or in the other app on this one.
 */
export function UnlockScreen({
  keys,
  coupleId,
  profileId,
  onUnlocked,
}: {
  keys: KeyService;
  coupleId: string;
  profileId: string;
  onUnlocked: () => Promise<void>;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [numbers, setNumbers] = useState<PendingDevice[] | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const attempt = async () => {
      try {
        // Publishing is idempotent, and doing it on every pass rather than once
        // means a device whose row was revoked reappears on its own.
        await keys.ensureDeviceKey(profileId);

        if ((await keys.tryAdoptWrap(coupleId, profileId)) === 'ready') {
          if (active) await onUnlocked();
          return;
        }

        // One number per device that could approve this one. Usually exactly
        // one; more only when a partner has several phones, in which case the
        // person approving is looking at one of these and the reader needs to
        // find it. Computed without the couple key — see `visibleDevices`.
        const candidates = await keys.visibleDevices(coupleId, profileId);
        if (active) setNumbers(candidates);
      } catch {
        if (active) setErrorKey('common:state.error');
      }
    };

    // Subscribe *before* the first attempt. A wrap that lands in the window
    // between the two would otherwise be missed by both — the fetch is too
    // early to see it and the subscription started too late to be told.
    const stop = keys.watchKeys(coupleId, () => void attempt());
    void attempt();

    return () => {
      active = false;
      stop();
    };
  }, [keys, coupleId, profileId, onUnlocked]);

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
          </View>
        </Card>

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
 * break.
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
  const [pending, setPending] = useState<PendingDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPending(await keys.pendingDevices(coupleId, profileId));
    } catch {
      setErrorKey('common:state.error');
    }
  }, [keys, coupleId, profileId]);

  useEffect(() => {
    const stop = keys.watchKeys(coupleId, () => void reload());
    void reload();
    return stop;
  }, [keys, coupleId, reload]);

  const approve = useCallback(
    async (device: PendingDevice) => {
      setBusy(device.deviceKeyId);
      setErrorKey(null);
      try {
        const outcome = await keys.verifyAndWrap(coupleId, profileId, device);
        if (!outcome.ok) {
          // `key_changed` is the one that matters: the public key moved between
          // the number being read aloud and this tap, so what the two people
          // compared is not what would have been wrapped.
          setErrorKey(`auth:keys.approve.error.${outcome.reason}`);
        }
        await reload();
      } catch {
        setErrorKey('common:state.error');
      } finally {
        setBusy(null);
      }
    },
    [keys, coupleId, profileId, reload],
  );

  return (
    <Screen>
      <View className="gap-6">
        <View className="gap-2">
          <Title>{t('auth:keys.approve.title')}</Title>
          <Muted>{t('auth:keys.approve.subtitle')}</Muted>
        </View>

        {pending === null ? <Loading /> : null}

        {pending?.length === 0 ? (
          <Card>
            <Body>{t('auth:keys.approve.none')}</Body>
          </Card>
        ) : null}

        {pending?.map((device) => (
          <Card key={device.deviceKeyId}>
            <View className="gap-3">
              <Heading>
                {device.isMine
                  ? t('auth:keys.approve.mineHeading')
                  : t('auth:keys.approve.partnerHeading')}
              </Heading>
              <Muted>{t('auth:keys.approve.compare')}</Muted>
              <Text selectable className={CODE_CLASS}>
                {device.safetyNumber}
              </Text>
              <Button
                label={t('auth:keys.approve.action')}
                loading={busy === device.deviceKeyId}
                onPress={() => void approve(device)}
              />
              <Muted>{t('auth:keys.approve.mismatch')}</Muted>
            </View>
          </Card>
        ))}

        {errorKey ? (
          <Card>
            <Body>{t(errorKey)}</Body>
          </Card>
        ) : null}

        <Button label={t('common:action.done')} variant="ghost" onPress={onDone} />
      </View>
    </Screen>
  );
}
