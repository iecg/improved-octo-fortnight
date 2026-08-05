/**
 * Account and pairing access — domain-agnostic, shared by every app.
 *
 * Pairing happens once and serves all of them: installing the second app never
 * asks the couple to link up again.
 */
import type { Couple, Locale, Profile } from '@couple/core';

import type { AppSupabaseClient } from './client';
import { toCouple, toProfile } from './mappers';

/** Why a redemption did not go through. Rendered via `pair.error.*` keys. */
export const JOIN_FAILURES = [
  'invalid_code',
  'couple_full',
  'already_paired',
  'rate_limited',
  'unknown',
] as const;
export type JoinFailure = (typeof JOIN_FAILURES)[number];

export type JoinCoupleResult = { ok: true; coupleId: string } | { ok: false; reason: JoinFailure };

/** An unrecognised reason renders as a generic message rather than leaking a raw token. */
function toJoinFailure(reason: string): JoinFailure {
  return (JOIN_FAILURES as readonly string[]).includes(reason)
    ? (reason as JoinFailure)
    : 'unknown';
}

/**
 * Narrow a PostgREST response to its payload.
 *
 * Written as two parameters rather than taking the response object whole:
 * Supabase types the result as a discriminated union (`{data, error: null}` or
 * `{data: null, error}`), and inferring `T` across both arms picks up the
 * `null` from the error branch.
 */
function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('no data returned');
  return data;
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
  getCouple(): Promise<Couple | null>;
  createCouple(timezone: string): Promise<Couple>;
  /** Edit the couple's shared fields. Only the grantable columns are writable. */
  updateCouple(id: string, patch: { anniversaryDate?: string | null }): Promise<Couple>;
  joinCouple(inviteCode: string): Promise<JoinCoupleResult>;
  leaveCouple(profileId: string): Promise<void>;
}

export function createAccountRepository(client: AppSupabaseClient): AccountRepository {
  return {
    async getCurrentUserId() {
      const { data } = await client.auth.getUser();
      return data.user?.id ?? null;
    },

    async getProfile(id) {
      const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toProfile(data) : null;
    },

    async getVisibleProfiles() {
      const { data, error } = await client.from('profiles').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []).map(toProfile);
    },

    async updateProfile(id, patch) {
      const { data, error } = await client
        .from('profiles')
        .update({
          ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
          ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
          ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        })
        .eq('id', id)
        .select()
        .single();
      return toProfile(unwrap(data, error));
    },

    async getCouple() {
      // RLS narrows this to the caller's own couple, so no filter is needed
      // and none could be trusted anyway.
      const { data, error } = await client.from('couples').select('*').maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toCouple(data) : null;
    },

    async createCouple(timezone) {
      const { data, error } = await client.rpc('create_couple', { p_timezone: timezone });
      return toCouple(unwrap(data, error));
    },

    async updateCouple(id, patch) {
      // Only `anniversary_date` is column-granted to members (alongside
      // `timezone`); a table-wide grant would let a client overwrite the invite
      // code, so the write stays this narrow.
      const { data, error } = await client
        .from('couples')
        .update({
          ...(patch.anniversaryDate !== undefined
            ? { anniversary_date: patch.anniversaryDate }
            : {}),
        })
        .eq('id', id)
        .select()
        .single();
      return toCouple(unwrap(data, error));
    },

    async joinCouple(inviteCode) {
      // Pairing goes through an RPC so invite codes are never exposed to
      // enumeration through the table API.
      //
      // Expected outcomes come back as reason codes rather than exceptions:
      // a raise would roll back the rate-limit counter recording the attempt,
      // and its English message would reach a partner reading Spanish.
      const { data, error } = await client.rpc('join_couple', {
        p_code: inviteCode.trim().toUpperCase(),
      });
      const result = unwrap(data, error);
      return result.ok
        ? { ok: true as const, coupleId: result.couple_id }
        : { ok: false as const, reason: toJoinFailure(result.reason) };
    },

    async leaveCouple(profileId) {
      const { error } = await client.from('couple_members').delete().eq('profile_id', profileId);
      if (error) throw new Error(error.message);
    },
  };
}
