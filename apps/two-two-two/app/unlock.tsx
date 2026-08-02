/**
 * Where a paired device with no couple key waits to be let in.
 *
 * Reachable only through the router, which sends every paired-but-keyless
 * session here rather than to the tabs — the alternative is a tab that mounts,
 * queries, and meets `MissingCoupleKeyError` inside a mapper.
 */
import { UnlockScreen } from '@couple/auth';
import { useRouter } from 'expo-router';

import { keyService } from '../src/runtime';
import { useSession } from '../src/session';

export default function Unlock() {
  const { session, couple, refresh } = useSession();
  const router = useRouter();
  if (!session || !couple) return null;

  return (
    <UnlockScreen
      keys={keyService}
      coupleId={couple.id}
      profileId={session.user.id}
      onUnlocked={refresh}
      onStuck={() => router.replace('/recovery')}
    />
  );
}
