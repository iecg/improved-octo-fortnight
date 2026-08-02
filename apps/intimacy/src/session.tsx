/**
 * This app's binding of the shared session module. The provider and hooks
 * themselves live in `@couple/auth` — there is one account and one pairing
 * across every app here, so the logic must not be duplicated per app.
 */
import { createSessionModule } from '@couple/auth';

import { i18n, keyService, sharedCipher, supabase } from './runtime';

export const { SessionProvider, useSession, usePairedSession } = createSessionModule({
  supabase,
  i18n,
  sharedCipher,
  keys: keyService,
});
