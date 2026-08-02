/**
 * What the two apps share, said out loud.
 *
 * There is one account and one pairing across both apps, and there always has
 * been — installing the second app finds the couple already connected. That is
 * the intended behaviour, but it is also the moment an app the user has never
 * opened before greets them by their partner's name, and nothing until now
 * told them why.
 *
 * The other half matters more: plans, notes, locations, check-ins and ideas do
 * *not* cross between the apps. That separation is a query-layer invariant
 * rather than something the database enforces, so the honest thing is to
 * describe it plainly rather than let people guess at it in either direction.
 *
 * Lives in this package, next to sign-in and pairing, so the text exists once
 * and is translated once. Both apps mount the same component, which is the
 * difference between the claim being true of both and being true of whichever
 * one was edited last.
 */
import { Body, Card, Heading, Muted } from '@couple/ui';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/** The bullets, as translation keys. Order is deliberate: shared first. */
const SHARED_KEYS = [
  'auth:connected.shared.account',
  'auth:connected.shared.pairing',
  'auth:connected.shared.timezone',
] as const;

const SEPARATE_KEYS = [
  'auth:connected.separate.plans',
  'auth:connected.separate.notes',
  'auth:connected.separate.language',
] as const;

function Bullets({ keys }: { keys: readonly string[] }) {
  const { t } = useTranslation(['auth']);
  return (
    <View className="gap-1.5">
      {keys.map((key) => (
        <Muted key={key}>{t(key)}</Muted>
      ))}
    </View>
  );
}

/**
 * The disclosure itself, without a container.
 *
 * Rendered inside a `Card` in Settings and inside the one-time notice screen,
 * so the two can never drift apart.
 */
export function ConnectedAppsBody() {
  const { t } = useTranslation(['auth']);

  return (
    <View className="gap-4">
      <View className="gap-2">
        <Heading>{t('auth:connected.sharedTitle')}</Heading>
        <Bullets keys={SHARED_KEYS} />
      </View>

      <View className="gap-2">
        <Heading>{t('auth:connected.separateTitle')}</Heading>
        <Bullets keys={SEPARATE_KEYS} />
      </View>
    </View>
  );
}

/** The Settings-screen form. Permanent, for anyone who tapped past the notice. */
export function ConnectedAppsCard() {
  const { t } = useTranslation(['auth']);

  return (
    <Card>
      <View className="gap-3">
        <Heading>{t('auth:connected.title')}</Heading>
        <Body>{t('auth:connected.summary')}</Body>
        <ConnectedAppsBody />
      </View>
    </Card>
  );
}
