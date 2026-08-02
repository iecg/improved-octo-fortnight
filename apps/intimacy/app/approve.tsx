/**
 * Where a device that already holds the couple key lets another one in.
 *
 * Deliberately outside the router's misplaced check for a ready session: it is
 * reachable only from a device that has the key, and bouncing the approver back
 * to the tabs is the deadlock this screen exists to break.
 */
import { ApproveScreen } from '@couple/auth';
import { useRouter } from 'expo-router';

import { keyService } from '../src/runtime';
import { useSession } from '../src/session';

export default function Approve() {
  const { session, couple } = useSession();
  const router = useRouter();
  if (!session || !couple) return null;

  return (
    <ApproveScreen
      keys={keyService}
      coupleId={couple.id}
      profileId={session.user.id}
      onDone={() => router.back()}
    />
  );
}
