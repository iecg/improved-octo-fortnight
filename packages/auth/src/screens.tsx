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
import { Text, TextInput, View } from 'react-native';

/** Must match `generate_invite_code()` in the pairing-hardening migration. */
export const INVITE_CODE_LENGTH = 8;

const INPUT_CLASS =
  'rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';

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
  timeZone,
  initialCode,
  onPaired,
  seedCadences,
}: {
  accounts: AccountRepository;
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
      setInviteCode(created.inviteCode);
      setMode('created');
      await onPaired();
    } catch {
      setErrorKey('auth:pair.error.unknown');
    } finally {
      setBusy(false);
    }
  }, [accounts, onPaired, seedCadences, timeZone]);

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
      await onPaired();
    } catch {
      setErrorKey('auth:pair.error.unknown');
    } finally {
      setBusy(false);
    }
  }, [accounts, code, onPaired, seedCadences]);

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

        {mode === 'created' && inviteCode ? (
          <Card>
            <View className="gap-3">
              <Heading>{t('auth:pair.yourCodeLabel')}</Heading>
              <Text
                selectable
                className="text-center text-3xl font-semibold tracking-[6px] text-ink dark:text-ink-dark"
              >
                {inviteCode}
              </Text>
              <Muted>{t('auth:pair.shareHint')}</Muted>
              <Muted>{t('auth:pair.waiting')}</Muted>
            </View>
          </Card>
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
