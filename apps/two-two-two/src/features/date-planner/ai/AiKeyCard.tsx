/**
 * The settings card where a key is entered, and the only place it is entered.
 *
 * Everything user-visible here comes from the `ai` namespace, including the
 * service names — built through `providerLabelKey` so no screen, and no string
 * in this file, has to name one.
 */
import { Body, Button, Card, Chip, Heading, Muted } from '@couple/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, TextInput, View } from 'react-native';

import { AI_PROVIDERS, AI_PROVIDER_IDS, providerLabelKey } from './providers';
import { useProviderKey, useSelectedProvider } from './use-provider-key';

const INPUT_CLASS =
  'min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';

export function AiKeyCard() {
  const { t } = useTranslation(['ai', 'common']);
  const { provider, select } = useSelectedProvider();
  const { status, model, defaultModel, busy, save, clear, setModel } = useProviderKey(provider);

  const [draft, setDraft] = useState('');
  const [rejected, setRejected] = useState(false);

  const definition = AI_PROVIDERS[provider];
  const trimmed = draft.trim();

  function choose(id: (typeof AI_PROVIDER_IDS)[number]) {
    // The field holds a secret for the provider being left; clear it rather
    // than carry it across.
    setDraft('');
    setRejected(false);
    select(id);
  }

  async function onSave() {
    if (!definition.looksLikeKey(trimmed)) {
      setRejected(true);
      return;
    }
    setRejected(false);
    await save(trimmed);
    setDraft('');
  }

  async function onClear() {
    setDraft('');
    setRejected(false);
    await clear();
  }

  return (
    <Card>
      <View className="gap-3">
        <Heading>{t('ai:settings.title')}</Heading>
        <Muted>{t('ai:settings.description')}</Muted>

        <View className="flex-row gap-2">
          {AI_PROVIDER_IDS.map((id) => (
            <Chip
              key={id}
              label={t(providerLabelKey(id))}
              selected={provider === id}
              onPress={() => choose(id)}
            />
          ))}
        </View>

        <View className="gap-2">
          <Body>{t('ai:settings.keyLabel')}</Body>
          <TextInput
            className={INPUT_CLASS}
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              setRejected(false);
            }}
            placeholder={t('ai:settings.keyPlaceholder')}
            accessibilityLabel={t('ai:settings.keyLabel')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
          />
          {rejected ? <Muted>{t('ai:settings.keyInvalid')}</Muted> : null}
          {status === 'loading' ? null : (
            <Muted>
              {status === 'present' ? t('ai:settings.keyStored') : t('ai:settings.keyAbsent')}
            </Muted>
          )}
        </View>

        <Button
          label={t('ai:settings.save')}
          variant="secondary"
          disabled={trimmed.length === 0}
          loading={busy}
          onPress={() => void onSave()}
        />

        {status === 'present' ? (
          <Button label={t('ai:settings.remove')} variant="ghost" onPress={() => void onClear()} />
        ) : null}

        <View className="gap-2">
          <Body>{t('ai:settings.modelLabel')}</Body>
          <TextInput
            className={INPUT_CLASS}
            value={model}
            onChangeText={(value) => void setModel(value)}
            placeholder={defaultModel}
            accessibilityLabel={t('ai:settings.modelLabel')}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Muted>{t('ai:settings.modelHint')}</Muted>
        </View>

        {/* The whole point of bringing your own key, said out loud. */}
        <Muted>{t('ai:settings.privacy')}</Muted>

        <Button
          label={t('ai:settings.getKey')}
          variant="ghost"
          onPress={() => void Linking.openURL(definition.consoleUrl)}
        />
      </View>
    </Card>
  );
}
