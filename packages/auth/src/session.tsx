/**
 * Session, profile, couple, and partner — resolved once and shared.
 *
 * Every app in this repo has exactly four states, and routing depends on
 * knowing which: signed out, signed in but unpaired, paired but without the
 * couple key, and ready. There is one account and one pairing across all of
 * them, so this is a factory over the app's Supabase client and i18n instance
 * rather than a copy per app.
 */
import type { Couple, Locale, Profile } from '@couple/core';
import type { FieldCipher } from '@couple/crypto';
import { createAccountRepository, type AppSupabaseClient } from '@couple/data';
import type { Session } from '@supabase/supabase-js';
import type { i18n as I18nInstance } from 'i18next';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import type { KeyService, KeyState } from './keys';

export interface SessionState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  couple: Couple | null;
  partner: Profile | null;
  /**
   * Whether this device can read the couple's rows.
   *
   * Resolved inside `load`, so `loading` already covers the window where it is
   * unknown and the router never has to model a third possibility.
   */
  keyState: KeyState;
  refresh: () => Promise<void>;
  setLocale: (locale: Locale) => Promise<void>;
  /**
   * Set or clear your own display name.
   *
   * Alongside `setLocale` rather than left to each screen, because it is the
   * same shape — write the profile, update the one copy of it every screen
   * reads — and because the name is sealed under the couple key, so it needs
   * the repository this module already holds rather than one a screen builds.
   */
  setDisplayName: (name: string | null) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export interface SessionModule {
  SessionProvider: (props: { children: ReactNode }) => JSX.Element;
  useSession: () => SessionState;
  usePairedSession: () => SessionState & { profile: Profile; couple: Couple };
}

export function createSessionModule(deps: {
  supabase: AppSupabaseClient;
  i18n: I18nInstance;
  /**
   * The `shared` cipher, which is what a partner's name is sealed under. Passed
   * in rather than built here so both apps use the one key store their
   * repositories already share.
   */
  sharedCipher: FieldCipher;
  /**
   * How the couple key gets into that key store. Injected for the same reason
   * the cipher is — and because its vault is a native module, which this
   * package must not import.
   */
  keys: KeyService;
}): SessionModule {
  const { supabase, i18n, keys } = deps;
  const accounts = createAccountRepository(supabase, deps.sharedCipher);

  function SessionProvider({ children }: { children: ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [couple, setCouple] = useState<Couple | null>(null);
    const [partner, setPartner] = useState<Profile | null>(null);
    const [keyState, setKeyState] = useState<KeyState>('absent');

    const load = useCallback(async (current: Session | null) => {
      if (!current) {
        setProfile(null);
        setCouple(null);
        setPartner(null);
        setKeyState('absent');
        return;
      }

      // Sequential, and the order is load-bearing.
      //
      // `getCouple()` is what tells the account repository which couple it is
      // reading for, and that id is the salt a name is sealed under; the key
      // has to be in the store before a name can be opened at all. Running
      // these concurrently — as this did — means the first load after sign-in
      // decrypts profiles against no couple and no key, and reports every name
      // as simply unset.
      const currentCouple = await accounts.getCouple();
      setCouple(currentCouple);

      const key = currentCouple ? await keys.adoptStoredKey(currentCouple.id) : 'absent';
      setKeyState(key);

      // RLS narrows `profiles` to exactly the caller and their partner, so one
      // unfiltered read gives both.
      const visible = await accounts.getVisibleProfiles();
      const me = visible.find((p) => p.id === current.user.id) ?? null;
      setProfile(me);
      setPartner(visible.find((p) => p.id !== current.user.id) ?? null);

      // The profile is the source of truth for language from here on; the device
      // locale only seeded the very first launch.
      if (me && me.locale !== i18n.language) {
        await i18n.changeLanguage(me.locale);
      }
    }, []);

    useEffect(() => {
      let active = true;

      void supabase.auth.getSession().then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        await load(data.session);
        if (active) setLoading(false);
      });

      const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
        setSession(next);
        void load(next);
      });

      return () => {
        active = false;
        subscription.subscription.unsubscribe();
      };
    }, [load]);

    const refresh = useCallback(async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      await load(data.session);
    }, [load]);

    const setLocale = useCallback(
      async (locale: Locale) => {
        if (!profile) return;
        // Switch the UI first so the tap feels instant, then persist.
        await i18n.changeLanguage(locale);
        const updated = await accounts.updateProfile(profile.id, { locale });
        setProfile(updated);
      },
      [profile],
    );

    const setDisplayName = useCallback(
      async (name: string | null) => {
        if (!profile) return;
        // `updateProfile` normalises and enforces the length rule; a screen
        // that checked first is being helpful, not authoritative.
        const updated = await accounts.updateProfile(profile.id, { displayName: name });
        setProfile(updated);
      },
      [profile],
    );

    const signOut = useCallback(async () => {
      // Memory only. The keychain copy stays, so signing back in on your own
      // phone does not need another approval — but nothing readable survives
      // the session that was holding it, and a *different* person signing in
      // here trips the couple-id check in `adoptStoredKey`, which clears the
      // keychain too.
      keys.lock();
      await supabase.auth.signOut();
    }, []);

    const value = useMemo<SessionState>(
      () => ({
        loading,
        session,
        profile,
        couple,
        partner,
        keyState,
        refresh,
        setLocale,
        setDisplayName,
        signOut,
      }),
      [
        loading,
        session,
        profile,
        couple,
        partner,
        keyState,
        refresh,
        setLocale,
        setDisplayName,
        signOut,
      ],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
  }

  function useSession(): SessionState {
    const context = useContext(SessionContext);
    if (!context) throw new Error('useSession must be used inside SessionProvider');
    return context;
  }

  /**
   * For screens that only render once paired *and* readable. Throwing here
   * keeps every such screen free of null checks that the router has already
   * guaranteed.
   *
   * The key clause is the enforcement three separate comments in this repo
   * already claimed existed — in each app's `runtime.ts`, in
   * `packages/crypto/src/store.ts` and in `packages/data/src/mappers.ts`.
   * Until now nothing checked it, and a keyless device reaching a tab would
   * have met `MissingCoupleKeyError` inside a mapper instead.
   */
  function usePairedSession(): SessionState & { profile: Profile; couple: Couple } {
    const session = useSession();
    if (!session.profile || !session.couple) {
      throw new Error('this screen requires a paired session');
    }
    if (session.keyState !== 'ready') {
      throw new Error('this screen requires the couple key');
    }
    return session as SessionState & { profile: Profile; couple: Couple };
  }

  return { SessionProvider, useSession, usePairedSession };
}
