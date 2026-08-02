import { PairScreen } from '@couple/auth';
import { createAccountRepository } from '@couple/data';
import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { plans } from '../src/queries';
import { DEFAULT_INTIMACY_CADENCES, sharedCipher, supabase } from '../src/runtime';
import { useSession } from '../src/session';

const accounts = createAccountRepository(supabase, sharedCipher);

export default function Pair() {
  const { refresh } = useSession();
  // Supports an invite link of the form `us://pair?code=ABCDEFGH`.
  const params = useLocalSearchParams<{ code?: string }>();

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
