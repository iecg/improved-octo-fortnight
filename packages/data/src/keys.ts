/**
 * The three key tables: device public keys, wraps, and the recovery envelope.
 *
 * **No cipher, and that is not an oversight.** Every other repository in this
 * package takes a `FieldCipher` because it reads rows whose contents are
 * sealed. These rows *are* the key material a cipher would need — a wrap that
 * had to be decrypted before it could be unwrapped would be a circle. What is
 * stored here is either public by definition (an X25519 public key) or already
 * sealed to exactly one recipient (a wrap, a recovery envelope), so there is
 * nothing left for a content key to do.
 *
 * Consequently this is also the one repository that is not domain-scoped:
 * invariant 2 separates the two apps' *content*, and there is exactly one
 * couple key underneath both.
 */
import type { RecoveryEnvelope, ScryptParams } from '@couple/crypto';

import type { AppSupabaseClient } from './client';

export interface DeviceKey {
  id: string;
  profileId: string;
  /** base64 of a 32-byte X25519 public key. */
  publicKey: string;
  createdAt: string;
}

export interface CoupleKeyWrap {
  deviceKeyId: string;
  epoch: number;
  wrappedKey: string;
  /**
   * The profile that produced the wrap — a person, not a device.
   *
   * A profile may have several devices, so this does not name the public key
   * needed to open it. The reader tries each of that profile's visible keys;
   * the Poly1305 tag is the discriminator, and the key that opens it is proof
   * of which device approved. A `wrapped_by_device_key_id` column would say the
   * same thing less trustworthily, since it would be a claim rather than a
   * consequence.
   */
  wrappedBy: string | null;
}

export interface KeyRepository {
  /** Every device of both partners. RLS narrows this to exactly that. */
  listDeviceKeys(): Promise<DeviceKey[]>;
  /**
   * Announce this device.
   *
   * Idempotent by necessity rather than by taste: both apps on one phone share
   * a keychain group by nothing at all, but a single app relaunching mid-pair
   * will re-publish, and two installs signing in at once is the normal case.
   * A unique violation on `(profile_id, public_key)` means the row this call
   * wanted already exists, which is success.
   */
  publishDeviceKey(profileId: string, publicKey: string): Promise<DeviceKey>;
  /**
   * Withdraw a device.
   *
   * `device_keys_delete_own` scopes this to your own rows, which is the whole
   * design: a partner's device row is their claim about their own phone, not
   * yours to retract. Deleting takes that device's wraps with it by cascade, so
   * a device that is let back in is let in afresh.
   */
  deleteDeviceKey(id: string): Promise<void>;

  /**
   * Every wrap for the couple, at every epoch.
   *
   * Not filtered by epoch, because the one caller who most needs this does not
   * know the epoch yet: a device waiting to be let in has no key, and the epoch
   * is a property of the key. It reads the epoch off the wrap that opens.
   */
  listWraps(coupleId: string): Promise<CoupleKeyWrap[]>;
  putWrap(input: {
    coupleId: string;
    deviceKeyId: string;
    epoch: number;
    wrappedKey: string;
    wrappedBy: string;
  }): Promise<void>;

  /**
   * This person's recovery envelope, if they have written a code down.
   *
   * No `.eq('profile_id', …)`. `couple_key_recovery_all_own` already narrows
   * this to exactly one row, and adding the filter would suggest the filter is
   * what protects it — the mistake invariant 2 exists to prevent, in the one
   * place where RLS genuinely is the whole guarantee.
   */
  getRecovery(): Promise<StoredRecovery | null>;
  /**
   * Seal a code's envelope, replacing any earlier one.
   *
   * An upsert on the primary key, so "save a code" and "replace the code" are
   * the same call — there is no state where a person has two.
   */
  putRecovery(input: {
    profileId: string;
    coupleId: string;
    epoch: number;
    envelope: RecoveryEnvelope;
  }): Promise<void>;

  /** Fires on any change to either key table. Returns its own unsubscribe. */
  watchKeys(coupleId: string, onChange: () => void): () => void;
}

export interface StoredRecovery {
  coupleId: string;
  epoch: number;
  envelope: RecoveryEnvelope;
}

const UNIQUE_VIOLATION = '23505';

/**
 * What `kdf_params` is allowed to say.
 *
 * The params come back from the server and are fed straight to scrypt, so an
 * operator who edited this row could ask a phone for `N = 2 ** 30` and hang it —
 * the one place in this schema where a server-controlled value turns into work
 * rather than into a failed tag. Bounding it costs nothing: the only params
 * this app has ever written are `SCRYPT_PARAMS`, and anything outside these
 * bounds is either tampering or a future version that will bump `kdf` anyway.
 */
const MAX_SCRYPT = { N: 2 ** 20, r: 16, p: 4, dkLen: 32 };

function toScryptParams(value: unknown): ScryptParams | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const { N, r, p, dkLen } = value as Record<string, unknown>;
  if (typeof N !== 'number' || typeof r !== 'number') return null;
  if (typeof p !== 'number' || typeof dkLen !== 'number') return null;
  if (N < 2 || N > MAX_SCRYPT.N || (N & (N - 1)) !== 0) return null;
  if (r < 1 || r > MAX_SCRYPT.r || p < 1 || p > MAX_SCRYPT.p) return null;
  if (dkLen !== MAX_SCRYPT.dkLen) return null;

  return { N, r, p, dkLen };
}

function toDeviceKey(row: {
  id: string;
  profile_id: string;
  public_key: string;
  created_at: string;
}): DeviceKey {
  return {
    id: row.id,
    profileId: row.profile_id,
    publicKey: row.public_key,
    createdAt: row.created_at,
  };
}

/** Makes each `watchKeys` channel topic its own — see the comment there. */
let watchers = 0;

export function createKeyRepository(client: AppSupabaseClient): KeyRepository {
  return {
    async listDeviceKeys() {
      const { data, error } = await client
        .from('device_keys')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map(toDeviceKey);
    },

    async publishDeviceKey(profileId, publicKey) {
      const { data, error } = await client
        .from('device_keys')
        .insert({ profile_id: profileId, public_key: publicKey })
        .select()
        .single();

      if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
      if (data) return toDeviceKey(data);

      // The row was already there. Re-select rather than construct one, because
      // the caller needs the id the partner will wrap against.
      const existing = await client
        .from('device_keys')
        .select('*')
        .eq('profile_id', profileId)
        .eq('public_key', publicKey)
        .single();
      if (existing.error) throw new Error(existing.error.message);
      return toDeviceKey(existing.data);
    },

    async deleteDeviceKey(id) {
      const { error } = await client.from('device_keys').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async listWraps(coupleId) {
      const { data, error } = await client
        .from('couple_key_wraps')
        .select('*')
        .eq('couple_id', coupleId)
        .order('epoch', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        deviceKeyId: row.device_key_id,
        epoch: row.epoch,
        wrappedKey: row.wrapped_key,
        wrappedBy: row.wrapped_by,
      }));
    },

    async putWrap(input) {
      const { error } = await client.from('couple_key_wraps').insert({
        couple_id: input.coupleId,
        device_key_id: input.deviceKeyId,
        epoch: input.epoch,
        wrapped_key: input.wrappedKey,
        wrapped_by: input.wrappedBy,
      });
      // Approving the same device twice is a double tap, not a failure.
      if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
    },

    async getRecovery() {
      const { data, error } = await client.from('couple_key_recovery').select('*').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;

      const params = toScryptParams(data.kdf_params);
      // A row this client cannot make sense of is treated as no row at all.
      // Reporting "you have a code" and then failing to open it would send
      // someone hunting for a piece of paper that was never going to work.
      if (data.kdf !== 'scrypt-v1' || params === null) return null;

      return {
        coupleId: data.couple_id,
        epoch: data.epoch,
        envelope: {
          kdf: 'scrypt-v1' as const,
          salt: data.kdf_salt,
          params,
          wrapped: data.wrapped_key,
        },
      };
    },

    async putRecovery(input) {
      const { error } = await client.from('couple_key_recovery').upsert(
        {
          profile_id: input.profileId,
          couple_id: input.coupleId,
          epoch: input.epoch,
          kdf: input.envelope.kdf,
          kdf_salt: input.envelope.salt,
          // Written out rather than spread, so the four numbers this column
          // may contain are stated in the same file that checks them on the
          // way back. `jsonb` would take anything; `toScryptParams` will not.
          kdf_params: {
            N: input.envelope.params.N,
            r: input.envelope.params.r,
            p: input.envelope.params.p,
            dkLen: input.envelope.params.dkLen,
          },
          wrapped_key: input.envelope.wrapped,
        },
        { onConflict: 'profile_id' },
      );
      if (error) throw new Error(error.message);
    },

    watchKeys(coupleId, onChange) {
      const channel = client
        /*
          The counter is what lets two components watch at once.

          `client.channel(topic)` returns the *existing* channel for a topic it
          already knows, so a second watcher on a fixed `keys:${coupleId}` does
          not get its own — it lands on one that has already been subscribed,
          and adding a handler there throws "cannot add postgres_changes
          callbacks ... after subscribe()". That stayed hidden while exactly one
          component watched; Settings now shows the invite panel and the device
          list side by side, and both need to know when a key arrives.

          A channel each, rather than a shared one with a list of listeners:
          teardown then belongs to the watcher that created it, and unmounting
          one cannot take the other's subscription down with it.
        */
        .channel(`keys:${coupleId}:${(watchers += 1)}`)
        // `device_keys` carries no couple_id to filter on — it is keyed by
        // profile. RLS is what narrows it, which is the same guarantee the
        // filter would have been asking for.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'device_keys' }, onChange)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'couple_key_wraps',
            filter: `couple_id=eq.${coupleId}`,
          },
          onChange,
        )
        .subscribe();

      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
