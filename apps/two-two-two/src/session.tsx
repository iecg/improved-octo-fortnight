/**
 * This app's binding of the shared session module. Installing this app after
 * the intimacy app finds the couple already paired — same account, same
 * `couple_members` row.
 */
import { createSessionModule } from '@couple/auth';

import { i18n, supabase } from './runtime';

export const { SessionProvider, useSession, usePairedSession } = createSessionModule({
  supabase,
  i18n,
});
