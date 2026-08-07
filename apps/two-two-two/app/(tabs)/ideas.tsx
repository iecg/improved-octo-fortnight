/**
 * Ideas: the answer to "what should we actually do".
 *
 * Two sources, neither of which needs a model to exist. The curated library
 * ships in the bundle and is translated like any other chrome, so both
 * partners read it in their own language. The shortlist is whatever the two of
 * them saved — including anything either typed in — and that text is
 * partner-authored, so it is shown verbatim and merely *labelled* with the
 * language it was written in when that differs from the reader's.
 *
 * Suggestions are the third source, and venues found on a map are the fourth.
 * Both are exactly that — sources alongside the other two, never replacements
 * for them. Everything above is rendered before anything asks whether a key is
 * configured; with no key the suggestion card collapses to one line pointing at
 * settings and the place search renders nothing at all, while the library and
 * the shortlist carry on unchanged. That is both optional-dependency rules as a
 * rendering decision rather than a promise: turn the keys off and this screen is
 * the screen it was before either feature existed.
 *
 * A suggestion is written by a model rather than by us, so it is treated like
 * a partner's own words rather than like chrome: generated in the reader's
 * language, saved with that language recorded, shown verbatim, and labelled
 * rather than machine-translated for whoever reads it in the other one. A
 * venue's name is authored by neither of them and is handled the same way.
 */
import { TWO_TWO_TWO_KINDS, kindLabelKey, type AppDomain, type PlanIdea } from '@couple/core';
import {
  Body,
  Button,
  Card,
  Chip,
  Disclosure,
  Divider,
  Heading,
  Loading,
  Muted,
  Screen,
  Title,
} from '@couple/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import {
  AiSuggestionCard,
  usePlannerInputs,
  type SuggestedIdea,
} from '../../src/features/date-planner/ai';
import { PlaceSearch } from '../../src/features/places/PlaceSearch';
import { libraryFor, ideaSummaryKey, ideaTitleKey } from '../../src/ideas';
import { useIdeas, useRemoveIdea, useSaveIdea } from '../../src/queries';
import { usePairedSession } from '../../src/session';

export default function Ideas() {
  const { t, i18n } = useTranslation(['app', 'common', 'cadence', 'ideas', 'ai']);
  const { profile, couple } = usePairedSession();
  const router = useRouter();

  const locale = i18n.language === 'es' ? 'es' : 'en';

  const [kind, setKind] = useState<string>(TWO_TWO_TWO_KINDS.date_night.kind);
  const [draft, setDraft] = useState('');

  /**
   * The suggestion form's own memory, borrowed.
   *
   * Both cards on this screen ask where the couple is planning around, and
   * being asked twice on one screen is the kind of thing that reads as the app
   * not paying attention. The screen hands both the same value; neither feature
   * imports the other, because neither of them owns the question.
   */
  const plannerInputs = usePlannerInputs(kind);

  const ideasQuery = useIdeas(couple.id);
  const save = useSaveIdea(couple.id, profile.id);
  const remove = useRemoveIdea(couple.id);

  const saved = useMemo(
    () => (ideasQuery.data ?? []).filter((idea) => idea.kind === kind),
    [ideasQuery.data, kind],
  );

  /** Ids already on the shortlist, so the library stops offering them. */
  const savedTitles = useMemo(() => new Set(saved.map((idea) => idea.title)), [saved]);

  /**
   * Carry the idea's id, not its place.
   *
   * The booking screen looks the place up rather than having it passed: a
   * coordinate pair in a navigation parameter is a string that has to be
   * re-parsed and can go stale, and the place list is already loaded there.
   */
  function planIt(title: string, ideaId?: string) {
    router.push({ pathname: '/plan/new', params: { kind, title, ...(ideaId ? { ideaId } : {}) } });
  }

  async function addOwn() {
    const title = draft.trim();
    if (!title) return;
    // Written by a partner, in whatever language they wrote it.
    await save.mutateAsync({ kind, title, source: 'manual', locale });
    setDraft('');
  }

  /**
   * A suggestion joins the shortlist only when someone deliberately saves it,
   * never because the other partner asked for some. It is stamped with the
   * language it was generated in — the asker's — so the reader in the other
   * language gets the label rather than a translation of a model's words.
   */
  async function saveSuggestion(idea: SuggestedIdea) {
    await save.mutateAsync({
      kind,
      title: idea.title,
      summary: idea.summary,
      estCostBand: idea.estCostBand,
      source: 'ai',
      locale,
    });
  }

  function SavedIdea({ idea }: { idea: PlanIdea }) {
    return (
      <View className="gap-2 py-2">
        {/* Shown exactly as written; never machine-translated. */}
        <Body>{idea.title}</Body>
        {idea.summary ? <Muted>{idea.summary}</Muted> : null}
        {/* Labelled, not translated, when it is not in the reader's language. */}
        {idea.locale !== locale ? <Muted>{t(`common:language.${idea.locale}`)}</Muted> : null}
        {/* Who wrote it is separate from what language it is in, and both matter. */}
        {idea.source === 'ai' ? <Muted>{t('app:ideas.fromAi')}</Muted> : null}
        <View className="flex-row gap-2">
          <View className="grow basis-0">
            <Button
              label={t('app:ideas.planIt')}
              variant="secondary"
              onPress={() => planIt(idea.title, idea.id)}
            />
          </View>
          <View className="grow basis-0">
            <Button
              label={t('common:action.delete')}
              variant="ghost"
              onPress={() => remove.mutate(idea.id)}
            />
          </View>
        </View>
      </View>
    );
  }

  if (ideasQuery.isLoading) return <Loading />;

  return (
    <Screen tabbed>
      <View className="gap-1">
        <Title>{t('app:ideas.title')}</Title>
        <Muted>{t('app:ideas.subtitle')}</Muted>
      </View>

      <View className="flex-row gap-2">
        {Object.values(TWO_TWO_TWO_KINDS).map((definition) => (
          <Chip
            key={definition.kind}
            label={t(kindLabelKey(definition.domain as AppDomain, definition.kind))}
            selected={kind === definition.kind}
            onPress={() => setKind(definition.kind)}
          />
        ))}
      </View>

      <Card>
        <View className="gap-2">
          <Heading>{t('app:ideas.yours')}</Heading>
          {saved.length === 0 ? <Muted>{t('app:ideas.emptyShortlist')}</Muted> : null}
          {saved.map((idea, index) => (
            <View key={idea.id}>
              {index > 0 ? <Divider /> : null}
              <SavedIdea idea={idea} />
            </View>
          ))}
        </View>
      </Card>

      {/* Typing one out is the least common way anybody fills this screen, and
          it is a text field — the single heaviest thing to have sitting open. */}
      <Disclosure label={t('app:ideas.addOwn')}>
        <Card>
          <View className="gap-2">
            <TextInput
              className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
              value={draft}
              onChangeText={setDraft}
              placeholder={t('app:ideas.addOwnPlaceholder')}
              accessibilityLabel={t('app:ideas.addOwn')}
            />
            <Muted>{t('app:ideas.addOwnHint')}</Muted>
            <Button
              label={t('app:ideas.add')}
              variant="secondary"
              disabled={draft.trim().length === 0}
              loading={save.isPending}
              onPress={() => void addOwn()}
            />
          </View>
        </Card>
      </Disclosure>

      <AiSuggestionCard
        kind={kind}
        locale={locale}
        savedTitles={savedTitles}
        onSave={(idea) => void saveSuggestion(idea)}
        onPlan={planIt}
      />

      {/* The fourth source. Renders nothing at all when no mapping key is
          configured — not even a line pointing at settings, because unlike the
          suggestion card there is nothing for a partner to set up on their own
          device. */}
      <PlaceSearch
        kind={kind}
        town={plannerInputs.location}
        onTownChange={plannerInputs.setLocation}
        onPick={(result) =>
          save.mutate({
            kind,
            title: result.name,
            summary: result.address ?? null,
            source: 'places',
            sourceDomain: 'google',
            locale,
            // Kept as a place row, not just flattened into the summary above:
            // the coordinates and the provider's id are what let this idea
            // carry a map, a drive time and a stay search into the booking.
            place: {
              name: result.name,
              address: result.address,
              provider: 'google',
              providerPlaceId: result.providerPlaceId,
              coordinates: result.coordinates,
              locale,
            },
          })
        }
      />

      {/*
        Eight entries for a date night, each a title, a summary and two buttons
        — roughly a thousand points, and the whole reason this screen scrolled
        past everything else on it.

        Open only when the shortlist for this kind is empty, because that is
        when it is the answer to the screen's own question rather than a list
        underneath one. `key={kind}` is what makes that work: the open state
        lives in `useState`, so without a remount, switching from a kind you
        have saved things for to one you have not would leave it shut on an
        empty screen.
      */}
      <Disclosure key={kind} label={t('app:ideas.library')} defaultOpen={saved.length === 0}>
        <Card>
          <View className="gap-2">
            <Muted>{t('app:ideas.libraryHint')}</Muted>
            {libraryFor(kind)
              .filter((id) => !savedTitles.has(t(ideaTitleKey(kind, id))))
              .map((id, index) => (
                <View key={id} className="gap-2 py-2">
                  {index > 0 ? <Divider /> : null}
                  <Body>{t(ideaTitleKey(kind, id))}</Body>
                  <Muted>{t(ideaSummaryKey(kind, id))}</Muted>
                  <View className="flex-row gap-2">
                    <View className="grow basis-0">
                      <Button
                        label={t('app:ideas.save')}
                        variant="secondary"
                        onPress={() =>
                          save.mutate({
                            kind,
                            title: t(ideaTitleKey(kind, id)),
                            summary: t(ideaSummaryKey(kind, id)),
                            source: 'library',
                            locale,
                          })
                        }
                      />
                    </View>
                    <View className="grow basis-0">
                      <Button
                        label={t('app:ideas.planIt')}
                        variant="ghost"
                        onPress={() => planIt(t(ideaTitleKey(kind, id)))}
                      />
                    </View>
                  </View>
                </View>
              ))}
          </View>
        </Card>
      </Disclosure>
    </Screen>
  );
}
