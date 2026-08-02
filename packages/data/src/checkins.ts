/**
 * Check-ins — intimacy-app-owned.
 *
 * Kept in its own module, reachable only through its own factory, so the 2-2-2
 * app has nothing to import even by accident. There is deliberately no
 * aggregate, no streak, and no count: a "not tonight" is a neutral answer, and
 * an app that turns it into a broken chain makes the problem worse.
 */
import type { Checkin, CheckinInterest } from '@couple/core';
import type { FieldCipher } from '@couple/crypto';

import type { AppSupabaseClient } from './client';
import { toCheckin } from './mappers';

export interface RecordCheckinInput {
  coupleId: string;
  profileId: string;
  /** `YYYY-MM-DD` in the couple's timezone. */
  onDate: string;
  interest: CheckinInterest;
  energy?: number | null;
  note?: string | null;
}

export interface CheckinRepository {
  /** Both partners' check-ins for a date — that is what makes them useful. */
  listForDate(coupleId: string, onDate: string): Promise<Checkin[]>;
  listRecent(coupleId: string, sinceDate: string): Promise<Checkin[]>;
  record(input: RecordCheckinInput): Promise<Checkin>;
  clear(profileId: string, onDate: string): Promise<void>;
}

export function createCheckinRepository(
  client: AppSupabaseClient,
  cipher: FieldCipher,
): CheckinRepository {
  if (cipher.scope !== 'intimacy') {
    throw new Error(`check-ins are intimacy-owned; got a ${cipher.scope} cipher`);
  }

  return {
    async listForDate(coupleId, onDate) {
      const { data, error } = await client
        .from('checkins')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('on_date', onDate);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toCheckin(row, cipher));
    },

    async listRecent(coupleId, sinceDate) {
      const { data, error } = await client
        .from('checkins')
        .select('*')
        .eq('couple_id', coupleId)
        .gte('on_date', sinceDate)
        .order('on_date', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toCheckin(row, cipher));
    },

    async record(input) {
      // One row per person per day; tapping again replaces the answer rather
      // than stacking another. Changing your mind is normal.
      const { data, error } = await client
        .from('checkins')
        .upsert(
          {
            couple_id: input.coupleId,
            profile_id: input.profileId,
            on_date: input.onDate,
            // Bound to (couple, profile, date) rather than to the row id,
            // because on conflict Postgres keeps the id already there and
            // discards anything the client sent — so an id-bound payload would
            // open on the first tap of the day and fail on the second.
            payload: cipher.seal(
              {
                interest: input.interest,
                energy: input.energy ?? null,
                note: input.note ?? null,
              },
              {
                table: 'checkins',
                coupleId: input.coupleId,
                profileId: input.profileId,
                onDate: input.onDate,
              },
            ),
          },
          { onConflict: 'profile_id,on_date' },
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toCheckin(data, cipher);
    },

    async clear(profileId, onDate) {
      const { error } = await client
        .from('checkins')
        .delete()
        .eq('profile_id', profileId)
        .eq('on_date', onDate);
      if (error) throw new Error(error.message);
    },
  };
}
