/**
 * Account and pairing access — domain-agnostic, shared by every app.
 *
 * Pairing happens once and serves all of them: installing the second app never
 * asks the couple to link up again.
 */
import {
  displayNameLength,
  DisplayNameTooLongError,
  isDisplayNameValid,
  normalizeDisplayName,
  type Couple,
  type Locale,
  type Profile,
} from '@couple/core';
import type { FieldCipher } from '@couple/crypto';

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
  joinCouple(inviteCode: string): Promise<JoinCoupleResult>;
  leaveCouple(profileId: string): Promise<void>;
}

export function createAccountRepository(
  client: AppSupabaseClient,
  cipher: FieldCipher,
): AccountRepository {
  if (cipher.scope !== 'shared') {
    throw new Error(`profiles are read by both apps and need a shared cipher; got ${cipher.scope}`);
  }

  /**
   * The couple a name is sealed against. Held here rather than passed per call
   * because it is the same for every profile this client will ever see, and
   * because RLS already guarantees it: the only profiles readable are the
   * caller's and their partner's.
   */
  let coupleId: string | null = null;

  return {
    async getCurrentUserId() {
      const { data } = await client.auth.getUser();
      return data.user?.id ?? null;
    },

    async getProfile(id) {
      const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toProfile(data, cipher, coupleId) : null;
    },

    async getVisibleProfiles() {
      const { data, error } = await client.from('profiles').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toProfile(row, cipher, coupleId));
    },

    async updateProfile(id, patch) {
      // A name can only be sealed once there is a couple key to seal it with,
      // and only once there is a partner it is for.
      if (patch.displayName !== undefined && coupleId === null) {
        throw new Error('a display name cannot be set before pairing');
      }

      // The length rule, enforced here because this is where the name stops
      // being readable. `profiles_name_payload_bounded` bounds the ciphertext
      // and cannot bound the name — the database has no way to measure a string
      // it cannot open. A screen checks this too, so the person is told before
      // they tap; this is what stops a caller that forgot.
      const name =
        patch.displayName === undefined ? undefined : normalizeDisplayName(patch.displayName);
      if (name !== undefined && !isDisplayNameValid(name)) {
        throw new DisplayNameTooLongError(displayNameLength(name ?? ''));
      }

      const { data, error } = await client
        .from('profiles')
        .update({
          ...(name !== undefined && coupleId !== null
            ? {
                name_payload:
                  name === null
                    ? null
                    : cipher.seal(
                        { displayName: name },
                        { table: 'profiles', coupleId, profileId: id },
                      ),
              }
            : {}),
          ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
          ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        })
        .eq('id', id)
        .select()
        .single();
      return toProfile(unwrap(data, error), cipher, coupleId);
    },

    async getCouple() {
      // RLS narrows this to the caller's own couple, so no filter is needed
      // and none could be trusted anyway.
      const { data, error } = await client.from('couples').select('*').maybeSingle();
      if (error) throw new Error(error.message);

      const couple = data ? toCouple(data) : null;
      coupleId = couple?.id ?? null;
      return couple;
    },

    async createCouple(timezone) {
      const { data, error } = await client.rpc('create_couple', { p_timezone: timezone });
      const couple = toCouple(unwrap(data, error));
      coupleId = couple.id;
      return couple;
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
      if (result.ok) coupleId = result.couple_id;
      return result.ok
        ? { ok: true as const, coupleId: result.couple_id }
        : { ok: false as const, reason: toJoinFailure(result.reason) };
    },

    async leaveCouple(profileId) {
      const { error } = await client.from('couple_members').delete().eq('profile_id', profileId);
      if (error) throw new Error(error.message);
      coupleId = null;
    },
  };
}
