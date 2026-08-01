/**
 * Account and pairing access — domain-agnostic, shared by every app.
 *
 * Pairing happens once and serves all of them: installing the second app never
 * asks the couple to link up again.
 */
import type { Couple, Locale, Profile } from '@couple/core';

import type { AppSupabaseClient } from './client';
import { toCouple, toProfile } from './mappers';

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('no data returned');
  return result.data;
}

export interface AccountRepository {
  getCurrentUserId(): Promise<string | null>;
  getProfile(id: string): Promise<Profile | null>;
  /** Both members of the couple. RLS makes this exactly you and your partner. */
  getVisibleProfiles(): Promise<Profile[]>;
  updateProfile(
    id: string,
    patch: { displayName?: string | null; locale?: Locale; timezone?: string },
  ): Promise<Profile>;
  setPushToken(id: string, token: string | null): Promise<void>;
  getCouple(): Promise<Couple | null>;
  createCouple(timezone: string): Promise<Couple>;
  joinCouple(inviteCode: string): Promise<string>;
  leaveCouple(profileId: string): Promise<void>;
}

export function createAccountRepository(client: AppSupabaseClient): AccountRepository {
  return {
    async getCurrentUserId() {
      const { data } = await client.auth.getUser();
      return data.user?.id ?? null;
    },

    async getProfile(id) {
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toProfile(data) : null;
    },

    async getVisibleProfiles() {
      const { data, error } = await client.from('profiles').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []).map(toProfile);
    },

    async updateProfile(id, patch) {
      const row = unwrap(
        await client
          .from('profiles')
          .update({
            ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
            ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
            ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
          })
          .eq('id', id)
          .select()
          .single(),
      );
      return toProfile(row);
    },

    async setPushToken(id, token) {
      const { error } = await client
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },

    async getCouple() {
      // RLS narrows this to the caller's own couple, so no filter is needed
      // and none could be trusted anyway.
      const { data, error } = await client.from('couples').select('*').maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toCouple(data) : null;
    },

    async createCouple(timezone) {
      const row = unwrap(await client.rpc('create_couple', { p_timezone: timezone }));
      return toCouple(row);
    },

    async joinCouple(inviteCode) {
      // Pairing goes through an RPC so invite codes are never exposed to
      // enumeration through the table API.
      return unwrap(await client.rpc('join_couple', { p_code: inviteCode.trim().toUpperCase() }));
    },

    async leaveCouple(profileId) {
      const { error } = await client
        .from('couple_members')
        .delete()
        .eq('profile_id', profileId);
      if (error) throw new Error(error.message);
    },
  };
}
