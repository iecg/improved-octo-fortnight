import { PairScreen } from '@couple/auth';
import { createAccountRepository } from '@couple/data';
import { useLocalSearchParams } from 'expo-router';

import { seedCadences } from '../src/queries';
import { supabase } from '../src/runtime';
import { useSession } from '../src/session';

const accounts = createAccountRepository(supabase);

export default function Pair() {
  const { refresh } = useSession();
  // Supports an invite link of the form `us://pair?code=ABCDEFGH`.
  const params = useLocalSearchParams<{ code?: string }>();

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
