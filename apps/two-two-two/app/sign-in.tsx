import { SignInScreen } from '@couple/auth';
import { useTranslation } from 'react-i18next';

import { supabase } from '../src/runtime';

export default function SignIn() {
  const { t } = useTranslation('app');
  return <SignInScreen client={supabase} title={t('brand.name')} subtitle={t('brand.tagline')} />;
}
