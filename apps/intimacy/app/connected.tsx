/**
 * The one-time "one account, both apps" notice.
 *
 * A modal rather than a fourth navigation state: the `misplaced` expression in
 * `_layout.tsx` is load-bearing on a cold start, and adding a case to it to
 * carry a notice would be trading a real hazard for a cosmetic gain.
 *
 * Shown once per install, not only on the second one. Someone installing this
 * app first has the same thing to learn — it just applies to the app they have
 * not installed yet.
 */
import { ConnectedAppsBody } from '@couple/auth';
import { markConnectedAppsNoticeSeen } from '@couple/device';
import { Body, Button, Screen, Title } from '@couple/ui';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

export default function Connected() {
  const { t } = useTranslation(['auth']);
  const router = useRouter();

  // Marked seen on dismissal rather than on mount: a notice killed by a crash
  // before it was read should come back.
  const dismiss = useCallback(async () => {
    await markConnectedAppsNoticeSeen();
    router.back();
  }, [router]);

  return (
    <Screen>
      <View className="flex-1 justify-center gap-6">
        <View className="gap-2">
          <Title>{t('auth:connected.title')}</Title>
          <Body>{t('auth:connected.summary')}</Body>
        </View>

        <ConnectedAppsBody />

        <Button label={t('auth:connected.acknowledge')} onPress={() => void dismiss()} />
      </View>
    </Screen>
  );
}
