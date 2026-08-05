import { PairScreen } from '@couple/auth';
import { createAccountRepository } from '@couple/data';
import { useLocalSearchParams } from 'expo-router';

import { seedCadences } from '../src/queries';
import { keyService, sharedCipher, supabase } from '../src/runtime';
import { useSession } from '../src/session';

const accounts = createAccountRepository(supabase, sharedCipher);

export default function Pair() {
  const { refresh, session } = useSession();
  // Supports an invite link of the form `us://pair?code=ABCDEFGH`.
  const params = useLocalSearchParams<{ code?: string }>();

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
