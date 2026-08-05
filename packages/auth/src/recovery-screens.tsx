/**
 * What to do when the ordinary way in is not available.
 *
 * Stages 4 and 5 built exactly one path: somebody else taps approve. That is
 * the right default and covers every case but one — both phones losing the key
 * at once, after which `/unlock` waits for a partner who is also waiting, and
 * the two of them wait at each other indefinitely.
 *
 * Three rungs, in ascending destructiveness, and the order on screen is the
 * order to try them in:
 *
 *   1. your partner lets you in      — nothing lost, and it is what `/unlock`
 *                                      is already doing behind this screen
 *   2. a recovery code               — nothing lost, if you wrote one down
 *   3. start over                    — everything lost, for both of you
 *
 * Rung 3 is unpairing rather than a key rotation, and the reason is in
 * CLAUDE.md: a rotation cannot erase what it leaves behind, because
 * `checkins_delete_own` scopes deletion to your own rows. Leaving the couple
 * deletes it through a `security definer` trigger and a cascade instead, which
 * reaches everything.
 */
import type { AccountRepository } from '@couple/data';
import { Body, Button, Card, Divider, Heading, Loading, Muted, Screen, Title } from '@couple/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput, View } from 'react-native';

import { useKeyWatch } from './invite';
import type { DeviceSummary, KeyService } from './keys';
import { CODE_CLASS, INPUT_CLASS } from './style';

/**
 * A ref that reports whether the component is still mounted.
 *
 * Every action on these screens is a slow network round trip — and one of them
 * is a slow *local* one — so every one of them can land after the router has
 * moved on. Recovering successfully guarantees it: the session refreshes,
 * `keyState` turns ready, and this screen is replaced on the same tick.
 */
function useAlive(): { readonly current: boolean } {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

export function RecoveryScreen({
  accounts,
  keys,
  coupleId,
  profileId,
  onUnlocked,
  onUnpaired,
  onBack,
}: {
  /**
   * Unpairing is an account operation, not a key one, so it comes from the same
   * repository `PairScreen` already takes. The key service cannot own it: it
   * would have to know about couples, and its whole shape is that it does not.
   */
  accounts: AccountRepository;
  keys: KeyService;
  coupleId: string;
  profileId: string;
  onUnlocked: () => Promise<void>;
  onUnpaired: () => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const alive = useAlive();

  const [code, setCode] = useState('');
  const [opening, setOpening] = useState(false);
  const [codeErrorKey, setCodeErrorKey] = useState<string | null>(null);

  const [confirmation, setConfirmation] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [leaveFailed, setLeaveFailed] = useState(false);

  const open = useCallback(async () => {
    setOpening(true);
    setCodeErrorKey(null);
    try {
      const outcome = await keys.recoverWithCode(coupleId, profileId, code);
      if (outcome.ok) {
        if (alive.current) await onUnlocked();
        return;
      }
      if (alive.current) setCodeErrorKey(`auth:keys.recovery.code.error.${outcome.reason}`);
    } catch {
      if (alive.current) setCodeErrorKey('common:state.error');
    } finally {
      if (alive.current) setOpening(false);
    }
  }, [keys, coupleId, profileId, code, onUnlocked, alive]);

  const unpair = useCallback(async () => {
    setLeaving(true);
    setLeaveFailed(false);
    try {
      // Leave first, forget second, and the order is not cosmetic. Forgetting
      // first and then failing to leave would produce a device that has thrown
      // its key away while still in the couple — routed straight back to
      // `/unlock`, waiting on a partner who by this point cannot help. The
      // other way round, a failure leaves everything as it was.
      await accounts.leaveCouple(profileId);
      await keys.forget();
      if (alive.current) await onUnpaired();
    } catch {
      if (alive.current) {
        setLeaveFailed(true);
        setLeaving(false);
      }
    }
  }, [accounts, keys, profileId, onUnpaired, alive]);

  // Compared against the *translated* word, so each partner types it in their
  // own language. Invariant 1 gets this for free; hard-coding "DELETE" would
  // have been the one string in the app a Spanish reader had to know in English.
  const confirmWord = t('auth:keys.recovery.startOver.confirmWord');
  const confirmed = confirmation.trim().toLowerCase() === confirmWord.toLowerCase();

  return (
    <Screen>
      <View className="gap-6">
        <View className="gap-2">
          <Title>{t('auth:keys.recovery.title')}</Title>
          <Muted>{t('auth:keys.recovery.subtitle')}</Muted>
        </View>

        <Card>
          <View className="gap-3">
            <Heading>{t('auth:keys.recovery.partner.title')}</Heading>
            <Body>{t('auth:keys.recovery.partner.body')}</Body>
            <Button
              label={t('auth:keys.recovery.partner.action')}
              variant="secondary"
              onPress={onBack}
            />
          </View>
        </Card>

        <Card>
          <View className="gap-3">
            <Heading>{t('auth:keys.recovery.code.title')}</Heading>
            <Body>{t('auth:keys.recovery.code.body')}</Body>
            <TextInput
              className={`${INPUT_CLASS} text-center tracking-[2px]`}
              value={code}
              onChangeText={(next) => setCode(next.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              accessibilityLabel={t('auth:keys.recovery.code.label')}
            />
            {/*
              No length check on the button. `normalizeRecoveryCode` folds
              hyphens, spaces and the ambiguous Crockford glyphs, so what counts
              as long enough is its business rather than this screen's — and a
              disabled button with no explanation is worse than an honest "that
              didn't work".
            */}
            <Button
              label={t('auth:keys.recovery.code.action')}
              loading={opening}
              disabled={code.trim().length === 0}
              onPress={() => void open()}
            />
            {codeErrorKey ? <Muted>{t(codeErrorKey)}</Muted> : null}
          </View>
        </Card>

        <Card>
          <View className="gap-3">
            <Heading>{t('auth:keys.recovery.startOver.title')}</Heading>
            <Body>{t('auth:keys.recovery.startOver.body')}</Body>
            {/*
              Said separately from the warning above because it is the part
              people do not expect: leaving reopens the seat, and the couple —
              with everything in it — is deleted only when the second person
              leaves. Until then the other phone still has a pairing, and still
              cannot read it.
            */}
            <Muted>{t('auth:keys.recovery.startOver.bothMust')}</Muted>

            <Divider />

            <Muted>{t('auth:keys.recovery.startOver.confirmHint', { word: confirmWord })}</Muted>
            <TextInput
              className={INPUT_CLASS}
              value={confirmation}
              onChangeText={setConfirmation}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              accessibilityLabel={t('auth:keys.recovery.startOver.confirmLabel')}
            />
            <Button
              label={t('auth:keys.recovery.startOver.action')}
              loading={leaving}
              disabled={!confirmed}
              onPress={() => void unpair()}
            />
            {leaveFailed ? <Muted>{t('common:state.error')}</Muted> : null}
          </View>
        </Card>
      </View>
    </Screen>
  );
}

/**
 * Saving a recovery code, from Settings, on a device that holds the key.
 *
 * Four states, and the third is the one the whole card exists for: the code is
 * displayed exactly once. It cannot be recovered from the envelope — that is
 * what the KDF is for — so this render is the only one there will ever be, and
 * the copy has to say so *while* it is on screen rather than after.
 */
export function RecoveryCodeCard({
  keys,
  coupleId,
  profileId,
}: {
  keys: KeyService;
  coupleId: string;
  profileId: string;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const alive = useAlive();

  const [saved, setSaved] = useState<boolean | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const has = await keys.recoveryStatus(coupleId);
        if (alive.current) setSaved(has);
      } catch {
        if (alive.current) setFailed(true);
      }
    })();
  }, [keys, coupleId, alive]);

  const save = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const fresh = await keys.saveRecoveryCode(coupleId, profileId);
      if (alive.current) {
        setCode(fresh);
        setSaved(true);
      }
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [keys, coupleId, profileId, alive]);

  return (
    <Card>
      <View className="gap-3">
        <Heading>{t('auth:keys.recovery.save.title')}</Heading>

        {code ? (
          <>
            <Body>{t('auth:keys.recovery.save.writeItDown')}</Body>
            <Text selectable className={CODE_CLASS}>
              {code}
            </Text>
            <Muted>{t('auth:keys.recovery.save.onlyOnce')}</Muted>
            <Button
              label={t('common:action.done')}
              variant="secondary"
              onPress={() => setCode(null)}
            />
          </>
        ) : (
          <>
            <Muted>{t('auth:keys.recovery.save.body')}</Muted>
            {saved === null ? <Loading /> : null}
            {saved === true ? <Body>{t('auth:keys.recovery.save.alreadySaved')}</Body> : null}
            {saved !== null ? (
              <Button
                label={t(
                  saved ? 'auth:keys.recovery.save.replace' : 'auth:keys.recovery.save.action',
                )}
                variant="secondary"
                loading={busy}
                onPress={() => void save()}
              />
            ) : null}
          </>
        )}

        {failed ? <Muted>{t('common:state.error')}</Muted> : null}
      </View>
    </Card>
  );
}

/**
 * Every device that has published a key, and which of them can read anything.
 *
 * There is no revoke button here, and its absence is the point. Withdrawing a
 * row is offered only for your own devices, because `device_keys_delete_own` is
 * all RLS permits — a partner's row is their claim about their own phone. And
 * withdrawing does not take back a key that device already holds: the key is in
 * its keychain, not in this table. The card says both things rather than
 * implying a control it does not have.
 */
export function DeviceListCard({
  keys,
  coupleId,
  profileId,
}: {
  keys: KeyService;
  coupleId: string;
  profileId: string;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const alive = useAlive();

  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const found = await keys.listDevices(coupleId, profileId);
      if (alive.current) setDevices(found);
    } catch {
      if (alive.current) setFailed(true);
    }
  }, [keys, coupleId, profileId, alive]);

  /*
    Not a bare `useEffect(reload, [])`, which is what this was: the approval that
    changes `hasKey` happens in `InvitePanel`, a sibling on this same screen, so
    nothing here ever unmounts to trigger a refetch. The list went on saying a
    device was "waiting to be let in" after it had been let in and was already
    reading — the wrong answer at exactly the moment someone is checking the
    approval worked. `useKeyWatch` runs on mount as well, so it replaces the
    effect rather than joining it.
  */
  useKeyWatch(keys, coupleId, reload);

  const withdraw = useCallback(
    async (device: DeviceSummary) => {
      setBusyId(device.deviceKeyId);
      setFailed(false);
      try {
        await keys.withdrawDevice(device.deviceKeyId);
        await reload();
      } catch {
        if (alive.current) setFailed(true);
      } finally {
        if (alive.current) setBusyId(null);
      }
    },
    [keys, reload, alive],
  );

  return (
    <Card>
      <View className="gap-3">
        <Heading>{t('auth:keys.devices.title')}</Heading>
        <Muted>{t('auth:keys.devices.subtitle')}</Muted>

        {devices === null ? <Loading /> : null}

        {devices?.map((device) => (
          <View key={device.deviceKeyId} className="gap-2">
            <Divider />
            <Body>
              {device.isThisDevice
                ? t('auth:keys.devices.thisDevice')
                : device.isMine
                  ? t('auth:keys.devices.mine')
                  : t('auth:keys.devices.partner')}
            </Body>
            <Muted>
              {device.hasKey ? t('auth:keys.devices.canRead') : t('auth:keys.devices.waiting')}
            </Muted>
            {device.safetyNumber ? (
              <Text selectable className={CODE_CLASS}>
                {device.safetyNumber}
              </Text>
            ) : null}
            {/*
              Your own devices, and never the one you are holding: withdrawing
              this device's row from this device would leave it invisible to a
              partner who might be about to approve it, and the next
              `ensureDeviceKey` would republish it anyway.
            */}
            {device.isMine && !device.isThisDevice ? (
              <Button
                label={t('auth:keys.devices.withdraw')}
                variant="ghost"
                loading={busyId === device.deviceKeyId}
                onPress={() => void withdraw(device)}
              />
            ) : null}
          </View>
        ))}

        <Muted>{t('auth:keys.devices.withdrawHint')}</Muted>

        {failed ? <Muted>{t('common:state.error')}</Muted> : null}
      </View>
    </Card>
  );
}
