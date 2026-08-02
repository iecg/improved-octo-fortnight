import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function TabsLayout() {
  const { t } = useTranslation('app');
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#9C5B4E' }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.today') }} />
      <Tabs.Screen name="plans" options={{ title: t('tabs.plans') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
    </Tabs>
  );
}
