import { useQuery } from '@tanstack/react-query';

import { getSignedChorePhotoUrl } from '@/lib/storage';

export function useSignedPhotoUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-photo-url', path],
    enabled: !!path,
    // Signed URLs expire in an hour server-side; refetch a little before that.
    staleTime: 50 * 60 * 1000,
    queryFn: () => getSignedChorePhotoUrl(path!),
  });
}
