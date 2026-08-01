/**
 * Pairing.
 *
 * One partner starts, the other joins with the code. This happens once and
 * serves every app in this repo — installing the 2-2-2 app later finds the
 * couple already connected.
 *
 * The code is redeemed through an RPC, never a table read, so it cannot be
 * enumerated; the server rotates it the moment it is used.
 */
import { createAccountRepository } from '@couple/data';
import { Body, Button, Card, Heading, Muted, Screen, Title } from '@couple/ui';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput, View } from 'react-native';

import { DEFAULT_INTIMACY_CADENCES, supabase } from '../src/runtime';
import { plans } from '../src/queries';
import { useSession } from '../src/session';

const accounts = createAccountRepository(supabase);

export default function Pair() {
  const { t } = useTranslation(['app', 'common']);
  const { refresh, couple } = useSession();
  // Supports an invite link of the form `us://pair?code=ABC123`.
  const params = useLocalSearchParams<{ code?: string }>();

  // Arriving from an invite link means the code is already known, so the join
  // step is the starting mode. Derived from the parameter rather than set by
  // an effect, which would render the chooser first and then replace it.
  const [mode, setMode] = useState<'choose' | 'created' | 'joining'>(
    params.code ? 'joining' : 'choose',
  );
  const [code, setCode] = useState(params.code ?? '');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  /**
   * Seed the standing rituals from the kind catalog in `@couple/core`. Doing
   * it here rather than in a database trigger keeps app vocabulary out of the
   * schema — the 2-2-2 app seeds its own.
   */
  const seedCadences = useCallback(async (coupleId: string) => {
    for (const kind of DEFAULT_INTIMACY_CADENCES) {
      await plans.upsertCadence({
        coupleId,
        kind: kind.kind,
        intervalValue: kind.defaultIntervalValue,
        intervalUnit: kind.defaultIntervalUnit,
      });
    }
  }, []);

  async function startCouple() {
    setBusy(true);
    setError(null);
    try {
      const created = await accounts.createCouple(timeZone);
      await seedCadences(created.id);
      setInviteCode(created.inviteCode);
      setMode('created');
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinCouple() {
    setBusy(true);
    setError(null);
    try {
      const joinedId = await accounts.joinCouple(code);
      await seedCadences(joinedId);
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="flex-1 justify-center gap-6">
        <View className="gap-2">
          <Title>{t('app:pair.title')}</Title>
          <Muted>{t('app:pair.subtitle')}</Muted>
        </View>

        {mode === 'choose' ? (
          <View className="gap-3">
            <Button
              label={t('app:pair.create')}
              loading={busy}
              onPress={() => void startCouple()}
            />
            <Button
              label={t('app:pair.join')}
              variant="secondary"
              onPress={() => setMode('joining')}
            />
          </View>
        ) : null}

        {mode === 'created' && inviteCode ? (
          <Card>
            <View className="gap-3">
              <Heading>{t('app:pair.yourCodeLabel')}</Heading>
              <Text
                selectable
                className="text-center text-4xl font-semibold tracking-[8px] text-ink dark:text-ink-dark"
              >
                {inviteCode}
              </Text>
              <Muted>{t('app:pair.shareHint')}</Muted>
              <Muted>{couple ? t('app:pair.waiting') : ''}</Muted>
            </View>
          </Card>
        ) : null}

        {mode === 'joining' ? (
          <Card>
            <View className="gap-3">
              <Heading>{t('app:pair.codeLabel')}</Heading>
              <TextInput
                className="rounded-xl border border-line bg-surface px-4 py-3 text-center text-2xl tracking-[6px] text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
                value={code}
                onChangeText={(next) => setCode(next.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                accessibilityLabel={t('app:pair.codeLabel')}
              />
              <Button
                label={t('app:pair.joinAction')}
                loading={busy}
                disabled={code.trim().length < 6}
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

        {error ? (
          <Card>
            <Body>{error}</Body>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
