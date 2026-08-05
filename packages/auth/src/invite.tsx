/**
 * Pairing and approval as one surface, because to the two people doing it they
 * are one act.
 *
 * Stage 4 put the invite code on the pairing screen and the approval behind
 * Settings, which meant the flow crossed a screen boundary at exactly the point
 * where the partner is standing next to you holding a phone. `InvitePanel` is
 * the same card in both places: it shows the code until somebody arrives, and
 * then shows what to do about them, in place.
 *
 * Everything here renders decisions made in `keys.ts`. The only judgement calls
 * that live at this layer are which of three states to show, and how often to
 * ask.
 */
import { Body, Button, Card, Heading, Muted } from '@couple/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { KeyService, PendingDevice } from './keys';
import { CODE_CLASS } from './style';

/**
 * How often the waiting screens re-ask, on top of the realtime subscription.
 *
 * Not belt-and-braces. `npm run db:test` runs SQL over a socket and never
 * touches Realtime, so nothing in the suite proves a `postgres_changes`
 * subscription is delivered under RLS over a websocket — and these are the only
 * screens in either app where a missed update is a dead end, with no
 * pull-to-refresh and no way for the user to tell "nobody has joined" apart
 * from "the socket is dead". Both screens are transient and someone is looking
 * at them, so five seconds is cheap.
 */
const POLL_MS = 5_000;

/**
 * Run something whenever the key tables might have changed: on mount, on a
 * realtime event, and on a timer.
 *
 * Subscribing happens *before* the first run, deliberately — a change landing
 * between the two would otherwise be missed by both, the fetch being too early
 * to see it and the subscription too late to be told.
 */
export function useKeyWatch(keys: KeyService, coupleId: string, run: () => unknown): void {
  // Callers rebuild `run` every render; re-subscribing that often would drop
  // events in every gap. The ref keeps the subscription stable and the callback
  // current.
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);

  useEffect(() => {
    const tick = () => void latest.current();
    const stop = keys.watchKeys(coupleId, tick);
    const timer = setInterval(tick, POLL_MS);
    tick();

    return () => {
      stop();
      clearInterval(timer);
    };
  }, [keys, coupleId]);
}

export interface DeviceApproval {
  /** `null` until the first read completes. */
  devices: PendingDevice[] | null;
  errorKey: string | null;
  busyId: string | null;
  /** Whether the mismatch explanation has been asked for. */
  dismissedAny: boolean;
  /**
   * Whether a device has actually been let in from this screen.
   *
   * Latched on the wrap succeeding rather than on the list emptying, because
   * the list also empties when a waiting device withdraws — which is exactly
   * what `resetDeviceKey` does, twice a second apart. "They're in" has to mean
   * they are in.
   */
  approvedAny: boolean;
  approve: (device: PendingDevice) => Promise<void>;
  dismiss: (device: PendingDevice) => void;
}

/**
 * The list of devices waiting to be let in, and the two things you can do to
 * one.
 *
 * A hook rather than state inside the component, because `InvitePanel` needs
 * the count to decide what to render *around* the list — an invite code is
 * worth showing right up until the moment somebody uses it, and not one render
 * longer.
 */
export function useDeviceApproval(
  keys: KeyService,
  coupleId: string,
  profileId: string,
): DeviceApproval {
  const [devices, setDevices] = useState<PendingDevice[] | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approvedAny, setApprovedAny] = useState(false);
  const [dismissedAny, setDismissedAny] = useState(false);
  // A ref, not state, and read at filter time. A poll in flight when the user
  // taps "these don't match" would otherwise close over the older set and hand
  // the refused device straight back — which is the one moment in this flow
  // where an unexpected reappearance is alarming rather than merely untidy.
  const dismissed = useRef(new Set<string>());

  const reload = useCallback(async () => {
    try {
      const found = await keys.pendingDevices(coupleId, profileId);
      // Filtered on every read: a dismissed device is still pending as far as
      // the database is concerned, and always will be until it withdraws.
      setDevices(found.filter((device) => !dismissed.current.has(device.deviceKeyId)));
    } catch {
      setErrorKey('common:state.error');
    }
  }, [keys, coupleId, profileId]);

  useKeyWatch(keys, coupleId, reload);

  const approve = useCallback(
    async (device: PendingDevice) => {
      setBusyId(device.deviceKeyId);
      setErrorKey(null);
      try {
        const outcome = await keys.verifyAndWrap(coupleId, profileId, device);
        if (outcome.ok) {
          setApprovedAny(true);
        } else {
          // `key_changed` is the one that matters: the public key moved between
          // the number being read aloud and this tap, so what the two people
          // compared is not what would have been wrapped.
          setErrorKey(`auth:keys.approve.error.${outcome.reason}`);
        }
        await reload();
      } catch {
        setErrorKey('common:state.error');
      } finally {
        setBusyId(null);
      }
    },
    [keys, coupleId, profileId, reload],
  );

  const dismiss = useCallback((device: PendingDevice) => {
    // Writes nothing, and that is the correct outcome rather than a shortcut:
    // no wrap exists until somebody taps approve, so a mismatch has nothing to
    // undo. Deleting the row is not on offer either — `device_keys_delete_own`
    // scopes deletion to your own devices, and a partner's row is their claim
    // about their own phone. The remedy lives on that phone, as
    // `resetDeviceKey`.
    dismissed.current.add(device.deviceKeyId);
    setDismissedAny(true);
    setDevices((current) =>
      (current ?? []).filter((candidate) => candidate.deviceKeyId !== device.deviceKeyId),
    );
  }, []);

  return { devices, errorKey, busyId, dismissedAny, approvedAny, approve, dismiss };
}

/** One card per device waiting, each with the number to read aloud. */
export function DeviceApprovalList({ approval }: { approval: DeviceApproval }) {
  const { t } = useTranslation(['auth', 'common']);

  return (
    <>
      {approval.devices?.map((device) => (
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
              loading={approval.busyId === device.deviceKeyId}
              onPress={() => void approval.approve(device)}
            />
            <Button
              label={t('auth:keys.approve.mismatchAction')}
              variant="ghost"
              onPress={() => approval.dismiss(device)}
            />
            <Muted>{t('auth:keys.approve.mismatch')}</Muted>
          </View>
        </Card>
      ))}

      {approval.dismissedAny ? (
        <Card>
          <Body>{t('auth:keys.approve.mismatchHelp')}</Body>
        </Card>
      ) : null}

      {approval.errorKey ? (
        <Card>
          <Body>{t(approval.errorKey)}</Body>
        </Card>
      ) : null}
    </>
  );
}

/**
 * The invite code, until it stops being the thing that matters.
 *
 * Four states. The transition from the first to the second is the point of this
 * stage; the other two exist because falling back to the first would be a lie:
 *
 * 1. a code and nobody waiting — share it;
 * 2. somebody waiting — the safety number replaces the code *in place*;
 * 3. somebody let in — say so;
 * 4. the partner appeared and is no longer waiting, unapproved — say that
 *    instead of re-displaying the code, because by then the code is dead.
 *    `join_couple` rotates it the instant it is redeemed and does not tell this
 *    device, so the arrival of a partner's device is this screen's only notice
 *    that what it is holding has expired. It is also a real transient:
 *    `resetDeviceKey` withdraws a device and republishes it a moment later.
 *
 * The partner/own distinction matters and `isMine` is what carries it — your own
 * second install publishes a device key without redeeming anything, so it must
 * not retire a code that is still good.
 *
 * Pass `code: null` once the couple is full. The code cannot be redeemed while
 * both seats are taken, but leaving reopens one, so a circulated code is a
 * liability rather than a convenience.
 */
export function InvitePanel({
  keys,
  coupleId,
  profileId,
  code,
}: {
  keys: KeyService;
  coupleId: string;
  profileId: string;
  code: string | null;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const approval = useDeviceApproval(keys, coupleId, profileId);
  const waiting = approval.devices ?? [];
  const partnerWaiting = waiting.some((device) => !device.isMine);

  // A one-way latch, scoped to this screen's life: once a partner's device has
  // been seen, the code in props is spent whatever happens next.
  const [partnerSeen, setPartnerSeen] = useState(false);
  useEffect(() => {
    if (partnerWaiting) setPartnerSeen(true);
  }, [partnerWaiting]);

  // Keep the list up while a dismissal is being explained. Otherwise tapping
  // "these don't match" on the only waiting device empties the list, and the
  // panel answers by claiming the device it just refused is in.
  if (waiting.length > 0 || approval.dismissedAny) {
    return <DeviceApprovalList approval={approval} />;
  }

  if (approval.approvedAny) {
    return (
      <Card>
        <View className="gap-2">
          <Heading>{t('auth:pair.partnerJoined')}</Heading>
          <Muted>{t('auth:pair.partnerJoinedHint')}</Muted>
        </View>
      </Card>
    );
  }

  if (partnerSeen) {
    return (
      <Card>
        <View className="gap-2">
          <Heading>{t('auth:pair.partnerAway')}</Heading>
          <Muted>{t('auth:pair.partnerAwayHint')}</Muted>
        </View>
      </Card>
    );
  }

  if (!code) return null;

  return (
    <Card>
      <View className="gap-3">
        <Heading>{t('auth:pair.yourCodeLabel')}</Heading>
        <Text selectable className={CODE_CLASS}>
          {code}
        </Text>
        <Muted>{t('auth:pair.shareHint')}</Muted>
        <Muted>{t('auth:pair.waiting')}</Muted>
      </View>
    </Card>
  );
}
