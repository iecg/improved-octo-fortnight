import { PairScreen } from '@couple/auth';
import { createAccountRepository } from '@couple/data';
import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { plans } from '../src/queries';
import { DEFAULT_CADENCES, keyService, sharedCipher, supabase } from '../src/runtime';
import { useSession } from '../src/session';

const accounts = createAccountRepository(supabase, sharedCipher);

export default function Pair() {
  const { refresh, session } = useSession();
  const params = useLocalSearchParams<{ code?: string }>();

  // Seeded from this app's own kind catalog. A database trigger would have
  // given every couple date-night cadences regardless of which app they
  // installed.
  const seedCadences = useCallback(async (coupleId: string) => {
    for (const kind of DEFAULT_CADENCES) {
      await plans.upsertCadence({
        coupleId,
        kind: kind.kind,
        intervalValue: kind.defaultIntervalValue,
        intervalUnit: kind.defaultIntervalUnit,
      });
    }
  }, []);

  // The router only routes a signed-in session here, but the type does not
  // know that and a non-null assertion would be a claim rather than a check.
  if (!session) return null;

  return (
    <PairScreen
      accounts={accounts}
      keys={keyService}
      profileId={session.user.id}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
      initialCode={params.code}
      onPaired={refresh}
      seedCadences={seedCadences}
    />
  );
}
