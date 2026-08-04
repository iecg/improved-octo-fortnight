/**
 * Your own name, as your partner will read it.
 *
 * It sits in Settings and nowhere else — no prompt after pairing, no card on
 * the home tab that reappears until you give in. Invariant 4 says this product
 * does not turn a "no" into a failure, and a name is the same kind of thing: an
 * app that keeps asking has decided that a couple who prefer "your partner" are
 * doing it wrong. The fallback is dignified, both apps already use it, and the
 * field is where anyone would look for it.
 *
 * Shared, like everything else in this package, because there is one account
 * across both apps. Setting a name in one is setting it in the other.
 */
import { DISPLAY_NAME_MAX, displayNameLength, normalizeDisplayName } from '@couple/core';
import { Body, Button, Card, Heading, Muted } from '@couple/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { INPUT_CLASS } from './style';

export function DisplayNameCard({
  displayName,
  onSave,
}: {
  /** The name as stored: already normalised, or null when there isn't one. */
  displayName: string | null;
  onSave: (name: string | null) => Promise<void>;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [draft, setDraft] = useState(displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The partner's device can change nothing here, but this device can — the
  // other app on the same phone writes the same row. Following the prop keeps
  // the field honest after a refresh without fighting the person typing, since
  // `displayName` only changes when a write lands.
  useEffect(() => {
    setDraft(displayName ?? '');
  }, [displayName]);

  const normalised = normalizeDisplayName(draft);
  const length = displayNameLength(draft);
  const tooLong = length > DISPLAY_NAME_MAX;
  const unchanged = normalised === displayName;

  const save = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onSave(normalised);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [onSave, normalised]);

  return (
    <Card>
      <View className="gap-3">
        <Heading>{t('auth:name.title')}</Heading>
        <Muted>{t('auth:name.description')}</Muted>

        <TextInput
          className={INPUT_CLASS}
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel={t('auth:name.label')}
          placeholder={t('auth:name.placeholder')}
        />

        {/*
          Shown only once it matters. A counter sitting there from the first
          keystroke turns a name into a form field with a budget, which is not
          what this screen is for.
        */}
        {tooLong ? <Body>{t('auth:name.tooLong', { max: DISPLAY_NAME_MAX })}</Body> : null}

        <Button
          label={t(normalised === null ? 'auth:name.clear' : 'auth:name.save')}
          loading={busy}
          disabled={tooLong || unchanged}
          onPress={() => void save()}
        />

        {failed ? <Muted>{t('common:state.error')}</Muted> : null}
      </View>
    </Card>
  );
}
