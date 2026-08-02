import { PairScreen } from '@couple/auth';
import { createAccountRepository } from '@couple/data';
import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { plans } from '../src/queries';
import { DEFAULT_CADENCES, supabase } from '../src/runtime';
import { useSession } from '../src/session';

const accounts = createAccountRepository(supabase);

export default function Pair() {
  const { refresh } = useSession();
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

  return (
    <PairScreen
      accounts={accounts}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
      initialCode={params.code}
      onPaired={refresh}
      seedCadences={seedCadences}
    />
  );
}
