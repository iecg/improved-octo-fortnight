/**
 * The three ways back in, when waiting for a partner is not going to work.
 *
 * Keyless-only, exactly like `/unlock` — `routeIntent` groups the two together.
 * A device that can read the couple's rows has nothing to recover, and the one
 * thing it might want from here, saving a code, is in Settings.
 */
import { RecoveryScreen } from '@couple/auth';
import { createAccountRepository } from '@couple/data';
import { useRouter } from 'expo-router';

import { keyService, sharedCipher, supabase } from '../src/runtime';
import { useSession } from '../src/session';

const accounts = createAccountRepository(supabase, sharedCipher);

export default function Recovery() {
  const { session, couple, refresh } = useSession();
  const router = useRouter();
  if (!session || !couple) return null;

  return (
    <RecoveryScreen
      accounts={accounts}
      keys={keyService}
      coupleId={couple.id}
      profileId={session.user.id}
      onUnlocked={refresh}
      onUnpaired={refresh}
      onBack={() => router.replace('/unlock')}
    />
  );
}
