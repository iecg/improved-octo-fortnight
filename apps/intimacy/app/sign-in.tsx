/**
 * Sign in with an emailed code.
 *
 * No password: one fewer secret for a couple to share, write down, or reuse.
 */
import { Body, Button, Card, Muted, Screen, Title } from '@couple/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { supabase } from '../src/runtime';

export default function SignIn() {
  const { t } = useTranslation(['app', 'common']);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    'rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';

  async function run(action: () => Promise<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: failure } = await action();
    setBusy(false);
    if (failure) setError(failure.message);
    return !failure;
  }

  async function sendCode() {
    const ok = await run(() => supabase.auth.signInWithOtp({ email: email.trim() }));
    if (ok) setSent(true);
  }

  async function verifyCode() {
    // The session lands in SecureStore and SessionProvider picks it up via
    // onAuthStateChange, which is what moves the router along.
    await run(() =>
      supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' }),
    );
  }

  return (
    <Screen>
      <View className="flex-1 justify-center gap-6">
        <View className="gap-2">
          <Title>{t('app:auth.title')}</Title>
          <Muted>{t('app:auth.subtitle')}</Muted>
        </View>

        <Card>
          {sent ? (
            <View className="gap-3">
              <Muted>{t('app:auth.sent', { email: email.trim() })}</Muted>
              <TextInput
                className={inputClass}
                value={code}
                onChangeText={setCode}
                placeholder={t('app:auth.codeLabel')}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                accessibilityLabel={t('app:auth.codeLabel')}
              />
              <Button
                label={t('app:auth.verify')}
                loading={busy}
                onPress={() => void verifyCode()}
              />
              <Button
                label={t('app:auth.useAnotherEmail')}
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
                className={inputClass}
                value={email}
                onChangeText={setEmail}
                placeholder={t('app:auth.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                accessibilityLabel={t('app:auth.emailLabel')}
              />
              <Button
                label={t('app:auth.send')}
                loading={busy}
                disabled={!email.includes('@')}
                onPress={() => void sendCode()}
              />
            </View>
          )}
        </Card>

        {error ? (
          <Card>
            <Body>{error}</Body>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
