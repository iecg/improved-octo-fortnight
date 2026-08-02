/**
 * Sign-in and pairing, shared by every app in the repo.
 *
 * These two screens are identical across apps by design: there is one account
 * and one pairing, so installing the second app finds the couple already
 * connected. Keeping them here rather than in each app is the difference
 * between that being true and it merely being intended.
 *
 * Both take their Supabase client and repositories as props. This package
 * stays free of the app-level singletons, so either app can mount them and
 * neither can drift.
 */
import type { AccountRepository, AppSupabaseClient } from '@couple/data';
import { Body, Button, Card, Heading, Muted, Screen, Title } from '@couple/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { InvitePanel } from './invite';
import type { KeyService } from './keys';
import { INPUT_CLASS } from './style';

/** Must match `generate_invite_code()` in the pairing-hardening migration. */
export const INVITE_CODE_LENGTH = 8;

export function SignInScreen({
  client,
  title,
  subtitle,
}: {
  client: AppSupabaseClient;
  /** App name and tagline — the only thing that differs between the two apps. */
  title: string;
  subtitle: string;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(action: () => Promise<{ error: unknown }>) {
    setBusy(true);
    setFailed(false);
    const { error } = await action();
    setBusy(false);
    // Supabase's message is English; this app has a partner reading Spanish.
    if (error) setFailed(true);
    return !error;
  }

  return (
    <Screen>
      <View className="flex-1 justify-center gap-6">
        <View className="gap-2">
          <Title>{title}</Title>
          <Muted>{subtitle}</Muted>
        </View>

        <Card>
          {sent ? (
            <View className="gap-3">
              <Muted>{t('auth:signIn.sent', { email: email.trim() })}</Muted>
              <TextInput
                className={INPUT_CLASS}
                value={code}
                onChangeText={setCode}
                placeholder={t('auth:signIn.codeLabel')}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                accessibilityLabel={t('auth:signIn.codeLabel')}
              />
              <Button
                label={t('auth:signIn.verify')}
                loading={busy}
                onPress={() =>
                  void run(() =>
                    client.auth.verifyOtp({
                      email: email.trim(),
                      token: code.trim(),
                      type: 'email',
                    }),
                  )
                }
              />
              <Button
                label={t('auth:signIn.useAnotherEmail')}
                variant="ghost"
                onPress={() => {
                  setSent(false);
                  setCode('');
                }}
              />
            </View>
          ) : (
            <View className="gap-3">
              <TextInput
                className={INPUT_CLASS}
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth:signIn.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                accessibilityLabel={t('auth:signIn.emailLabel')}
              />
              <Button
                label={t('auth:signIn.send')}
                loading={busy}
                disabled={!email.includes('@')}
                onPress={() =>
                  void run(() => client.auth.signInWithOtp({ email: email.trim() })).then((ok) => {
                    if (ok) setSent(true);
                  })
                }
              />
            </View>
          )}
        </Card>

        {failed ? (
          <Card>
            <Body>{t('auth:signIn.failed')}</Body>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

export function PairScreen({
  accounts,
  keys,
  profileId,
  timeZone,
  initialCode,
  onPaired,
  seedCadences,
}: {
  accounts: AccountRepository;
  /**
   * Pairing is also where key material begins: the founder mints the couple
   * key, and the joiner publishes the device key their partner will wrap to.
   * Neither can happen before there is a couple to bind them to.
   */
  keys: KeyService;
  profileId: string;
  timeZone: string;
  /** Present when arriving from an invite link. */
  initialCode?: string;
  onPaired: () => Promise<void>;
  /**
   * Seed the app's standing rituals from its own kind catalog. Passed in
   * rather than done here, and deliberately not a database trigger: a trigger
   * on `couples` would seed every app's cadences for every couple, whichever
   * app they actually installed.
   */
  seedCadences: (coupleId: string) => Promise<void>;
}) {
  const { t } = useTranslation(['auth', 'common']);

  const [mode, setMode] = useState<'choose' | 'created' | 'joining'>(
    initialCode ? 'joining' : 'choose',
  );
  const [code, setCode] = useState(initialCode ?? '');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  // Held from `createCouple` rather than read back from the session, because
  // the session deliberately is not refreshed while this screen is up.
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A translation key, never a server string: Postgres speaks English and one
  // of these two partners does not.
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const startCouple = useCallback(async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const created = await accounts.createCouple(timeZone);
      await seedCadences(created.id);
      // The couple key is minted here and nowhere else. Exactly one device ever
      // runs this, which is what makes "one key per couple" a fact rather than
      // a convention — every other device receives it wrapped.
      await keys.createCoupleKey(created.id, profileId);
      setCoupleId(created.id);
      setInviteCode(created.inviteCode);
      setMode('created');
      // Deliberately *not* `onPaired()` here. It refreshes the session, which
      // sets `couple` and `keyState: 'ready'` together, and the router would
      // replace this screen before the invite code below could be read. The
      // Continue button calls it instead.
    } catch {
      setErrorKey('auth:pair.error.unknown');
    } finally {
      setBusy(false);
    }
  }, [accounts, keys, profileId, seedCadences, timeZone]);

  const joinCouple = useCallback(async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await accounts.joinCouple(code);
      if (!result.ok) {
        setErrorKey(`auth:pair.error.${result.reason}`);
        return;
      }
      await seedCadences(result.coupleId);
      // Publish this device's public key on the way in, so the partner's
      // approval screen has something to show the moment they look at it. The
      // key itself arrives later, on `/unlock`.
      await keys.ensureDeviceKey(profileId);
      await onPaired();
    } catch {
      setErrorKey('auth:pair.error.unknown');
    } finally {
      setBusy(false);
    }
  }, [accounts, code, keys, onPaired, profileId, seedCadences]);

  return (
    <Screen>
      <View className="flex-1 justify-center gap-6">
        <View className="gap-2">
          <Title>{t('auth:pair.title')}</Title>
          <Muted>{t('auth:pair.subtitle')}</Muted>
        </View>

        {mode === 'choose' ? (
          <View className="gap-3">
            <Button
              label={t('auth:pair.create')}
              loading={busy}
              onPress={() => void startCouple()}
            />
            <Button
              label={t('auth:pair.join')}
              variant="secondary"
              onPress={() => setMode('joining')}
            />
          </View>
        ) : null}

        {mode === 'created' && coupleId && inviteCode ? (
          <>
            {/*
              The panel keeps watching: when the partner redeems the code their
              device appears here and the safety number takes the code's place,
              without anyone navigating anywhere. Pairing and approval are one
              act to the two people doing it, and this is where that stops being
              two screens.
            */}
            <InvitePanel keys={keys} coupleId={coupleId} profileId={profileId} code={inviteCode} />
            {/*
              Unconditional, and not only because the founder needs an escape
              hatch from a screen that is otherwise waiting on someone else.
              Without a button here the founder never sees their own invite code
              at all: `startCouple` used to call `onPaired()` itself, which set
              `couple` and let the router replace this screen on the same tick,
              so the card above rendered and was gone. Whatever is left
              unapproved is waiting in Settings.
            */}
            <Button label={t('common:action.next')} onPress={() => void onPaired()} />
          </>
        ) : null}

        {mode === 'joining' ? (
          <Card>
            <View className="gap-3">
              <Heading>{t('auth:pair.codeLabel')}</Heading>
              <TextInput
                className={`${INPUT_CLASS} text-center text-2xl tracking-[6px]`}
                value={code}
                onChangeText={(next) => setCode(next.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={INVITE_CODE_LENGTH}
                accessibilityLabel={t('auth:pair.codeLabel')}
              />
              <Button
                label={t('auth:pair.joinAction')}
                loading={busy}
                disabled={code.trim().length < INVITE_CODE_LENGTH}
                onPress={() => void joinCouple()}
              />
              <Button
                label={t('common:action.back')}
                variant="ghost"
                onPress={() => setMode('choose')}
              />
            </View>
          </Card>
        ) : null}

        {errorKey ? (
          <Card>
            <Body>{t(errorKey)}</Body>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
