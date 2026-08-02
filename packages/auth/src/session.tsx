/**
 * Session, profile, couple, and partner — resolved once and shared.
 *
 * Every app in this repo has exactly three states, and routing depends on
 * knowing which: signed out, signed in but unpaired, and paired. There is one
 * account and one pairing across all of them, so this is a factory over the
 * app's Supabase client and i18n instance rather than a copy per app.
 */
import type { Couple, Locale, Profile } from '@couple/core';
import { createAccountRepository, type AppSupabaseClient } from '@couple/data';
import type { Session } from '@supabase/supabase-js';
import type { i18n as I18nInstance } from 'i18next';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

export interface SessionState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  couple: Couple | null;
  partner: Profile | null;
  refresh: () => Promise<void>;
  setLocale: (locale: Locale) => Promise<void>;
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
}): SessionModule {
  const { supabase, i18n } = deps;
  const accounts = createAccountRepository(supabase);

  function SessionProvider({ children }: { children: ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [couple, setCouple] = useState<Couple | null>(null);
    const [partner, setPartner] = useState<Profile | null>(null);

    const load = useCallback(async (current: Session | null) => {
      if (!current) {
        setProfile(null);
        setCouple(null);
        setPartner(null);
        return;
      }

      // RLS narrows `profiles` to exactly the caller and their partner, so one
      // unfiltered read gives both.
      const [visible, currentCouple] = await Promise.all([
        accounts.getVisibleProfiles(),
        accounts.getCouple(),
      ]);

      const me = visible.find((p) => p.id === current.user.id) ?? null;
      setProfile(me);
      setPartner(visible.find((p) => p.id !== current.user.id) ?? null);
      setCouple(currentCouple);

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

    const signOut = useCallback(async () => {
      await supabase.auth.signOut();
    }, []);

    const value = useMemo<SessionState>(
      () => ({ loading, session, profile, couple, partner, refresh, setLocale, signOut }),
      [loading, session, profile, couple, partner, refresh, setLocale, signOut],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
  }

  function useSession(): SessionState {
    const context = useContext(SessionContext);
    if (!context) throw new Error('useSession must be used inside SessionProvider');
    return context;
  }

  /**
   * For screens that only render once paired. Throwing here keeps every such
   * screen free of null checks that the router has already guaranteed.
   */
  function usePairedSession(): SessionState & { profile: Profile; couple: Couple } {
    const session = useSession();
    if (!session.profile || !session.couple) {
      throw new Error('this screen requires a paired session');
    }
    return session as SessionState & { profile: Profile; couple: Couple };
  }

  return { SessionProvider, useSession, usePairedSession };
}
