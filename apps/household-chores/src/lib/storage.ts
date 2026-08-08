import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

const CHORE_PHOTOS_BUCKET = 'chore-photos';

/**
 * Uploads a locally-picked photo to the private chore-photos bucket.
 *
 * React Native's fetch/Blob upload path to Supabase Storage is unreliable, so
 * we hand Storage the raw bytes instead. expo-file-system's File.bytes() gives
 * us those directly -- the older readAsStringAsync({encoding:'base64'}) route
 * was removed in SDK 54 (it now throws) and needed a base64 -> ArrayBuffer
 * decode step that this avoids entirely.
 */
export async function uploadChorePhoto(params: {
  householdId: string;
  instanceId: string;
  localUri: string;
}): Promise<string> {
  const { householdId, instanceId, localUri } = params;

  const bytes = await new File(localUri).bytes();

  const path = `${householdId}/${instanceId}/${Date.now()}.jpg`;

  const { error } = await supabase.storage.from(CHORE_PHOTOS_BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) throw error;
  return path;
}

/** Private bucket: photos are always shown via a short-lived signed URL. */
export async function getSignedChorePhotoUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CHORE_PHOTOS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) throw error;
  return data.signedUrl;
}
