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

  /** Fires on any change to either key table. Returns its own unsubscribe. */
  watchKeys(coupleId: string, onChange: () => void): () => void;
}

const UNIQUE_VIOLATION = '23505';

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

    watchKeys(coupleId, onChange) {
      const channel = client
        .channel(`keys:${coupleId}`)
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
