/**
 * The third source on the ideas screen, and the only part of it that needs a
 * key.
 *
 * It takes what it needs as props and imports no repository, so there is
 * nothing here that *could* reach a plan, a check-in, or the other app's rows
 * even by accident. What leaves the device is decided in `prompt.ts` and
 * nowhere else.
 *
 * With no key configured this collapses to a single line pointing at settings,
 * and the two sources above it carry on exactly as before. That is the
 * AI-optional rule as a rendering decision rather than a promise.
 *
 * The three form fields live in a session store rather than in this component,
 * because the card unmounts on a tab change and nobody should retype their
 * city for that. See `session-inputs.ts` for why budget is per kind and
 * location is not, and for why none of it is written to disk.
 */
import type { Locale } from '@couple/core';
import { Body, Button, Card, Divider, Heading, Muted } from '@couple/ui';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { MAX_IDEAS } from './client';
import type { SuggestedIdea } from './parse';
import { usePlannerInputs } from './session-inputs';
import { useProviderKey, useSelectedProvider } from './use-provider-key';
import { useSuggestions } from './use-suggestions';

const INPUT_CLASS =
  'min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';

export interface AiSuggestionCardProps {
  kind: string;
  /** The reader's language. The model answers in it, and the row is stamped with it. */
  locale: Locale;
  /** Titles already on the shortlist, so a repeat is dropped without asking. */
  savedTitles: ReadonlySet<string>;
  onSave(idea: SuggestedIdea): void;
  onPlan(title: string): void;
}

function Suggestion({
  idea,
  onSave,
  onPlan,
}: {
  idea: SuggestedIdea;
  onSave(): void;
  onPlan(): void;
}) {
  const { t } = useTranslation(['app']);
  return (
    <View className="gap-2 py-2">
      {/* Written by a model, in the reader's language; shown exactly as it came back. */}
      <Body>{idea.title}</Body>
      {idea.summary ? <Muted>{idea.summary}</Muted> : null}
      <View className="flex-row gap-2">
        <View className="grow basis-0">
          <Button label={t('app:ideas.save')} variant="secondary" onPress={onSave} />
        </View>
        <View className="grow basis-0">
          <Button label={t('app:ideas.planIt')} variant="ghost" onPress={onPlan} />
        </View>
      </View>
    </View>
  );
}

export function AiSuggestionCard({
  kind,
  locale,
  savedTitles,
  onSave,
  onPlan,
}: AiSuggestionCardProps) {
  const { t } = useTranslation(['ai', 'app']);
  const { provider } = useSelectedProvider();
  const { status } = useProviderKey(provider);
  const { ideas, isPending, errorKey, generate, dismiss } = useSuggestions(provider);

  // Session-lived, and budget is keyed by kind: switching the chip swaps what
  // you are willing to spend on an evening for what you would spend on a
  // fortnight, while leaving the place you are planning around alone.
  const { location, budget, hint, setLocation, setBudget, setHint } = usePlannerInputs(kind);

  // Deduped here rather than by telling the model what is already saved:
  // the shortlist is partner-authored, and sending it would ship private text
  // to a third party for a cosmetic gain.
  const fresh = ideas.filter((idea) => !savedTitles.has(idea.title));

  if (status === 'loading') return null;

  if (status === 'absent') {
    return (
      <Card>
        <View className="gap-2">
          <Heading>{t('ai:suggest.title')}</Heading>
          <Muted>{t('ai:suggest.notConfigured')}</Muted>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <View className="gap-2">
        <Heading>{t('ai:suggest.title')}</Heading>

        <Body>{t('ai:suggest.location')}</Body>
        <TextInput
          className={INPUT_CLASS}
          value={location}
          onChangeText={setLocation}
          placeholder={t('ai:suggest.locationPlaceholder')}
          accessibilityLabel={t('ai:suggest.location')}
        />

        <Body>{t('ai:suggest.budget')}</Body>
        <TextInput
          className={INPUT_CLASS}
          value={budget}
          onChangeText={setBudget}
          placeholder={t('ai:suggest.budgetPlaceholder')}
          accessibilityLabel={t('ai:suggest.budget')}
        />

        <Body>{t('ai:suggest.hint')}</Body>
        <TextInput
          className={INPUT_CLASS}
          value={hint}
          onChangeText={setHint}
          placeholder={t('ai:suggest.hintPlaceholder')}
          accessibilityLabel={t('ai:suggest.hint')}
        />

        {/* The only thing telling anyone that the city they typed leaves the
            device, so it covers all three fields rather than just the last. */}
        <Muted>{t('ai:suggest.inputsNote')}</Muted>

        <Button
          label={ideas.length > 0 ? t('ai:suggest.again') : t('ai:suggest.generate')}
          variant="secondary"
          loading={isPending}
          onPress={() => generate({ kind, locale, count: MAX_IDEAS, location, budget, hint })}
        />

        {errorKey ? <Muted>{t(errorKey)}</Muted> : null}

        {fresh.map((idea, index) => (
          <View key={idea.title}>
            {index > 0 ? <Divider /> : null}
            <Suggestion idea={idea} onSave={() => onSave(idea)} onPlan={() => onPlan(idea.title)} />
          </View>
        ))}

        {ideas.length > 0 ? (
          <View className="gap-2">
            <Muted>{t('ai:suggest.disclaimer')}</Muted>
            <Button label={t('ai:suggest.dismiss')} variant="ghost" onPress={dismiss} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}
