/**
 * Giving up the seat in a couple.
 *
 * Lives beside sign-in and pairing rather than in either app, for the reason
 * the rest of this package exists: there is one pairing across both apps, so
 * leaving is one act with one wording. Copying it into an app would be the
 * first step to the two apps disagreeing about what unpairing means.
 *
 * The database is what makes this safe to offer. Leaving rotates the couple's
 * invite code — otherwise the code the departing partner had already given out
 * would quietly become live again for the reopened seat — and a couple with no
 * members left is deleted rather than kept behind a redeemable code.
 *
 * The confirm step is deliberately a second tap rather than an `Alert`: it
 * renders through the same translated primitives as everything else, so it
 * reads in the user's own language on both platforms.
 */
import { Body, Button, Card, Heading } from '@couple/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

export function UnpairCard({ onUnpair }: { onUnpair: () => Promise<void> }) {
  const { t } = useTranslation(['auth']);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function unpair() {
    setPending(true);
    try {
      await onUnpair();
    } finally {
      // The provider reloads and the router moves to `/pair`, so this component
      // is usually gone by now — but a failed delete must leave a usable card
      // rather than a spinner that never stops.
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <View className="gap-3">
        <Heading>{t('auth:unpair.title')}</Heading>
        <Body>{t('auth:unpair.summary')}</Body>

        {confirming ? (
          <View className="gap-2">
            <Button
              label={t('auth:unpair.confirm')}
              loading={pending}
              onPress={() => void unpair()}
            />
            <Button
              label={t('auth:unpair.cancel')}
              variant="ghost"
              disabled={pending}
              onPress={() => setConfirming(false)}
            />
          </View>
        ) : (
          <Button
            label={t('auth:unpair.action')}
            variant="secondary"
            onPress={() => setConfirming(true)}
          />
        )}
      </View>
    </Card>
  );
}
