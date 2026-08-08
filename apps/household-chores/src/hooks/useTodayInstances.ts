import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { todayDateOnly } from '@/lib/cadence';
import { supabase } from '@/lib/supabase';
import type { Chore, ChoreInstance, Profile } from '@/types';

export interface ChoreInstanceWithChore extends ChoreInstance {
  chores: Chore;
  profiles: Profile | null; // the assignee's profile
}

/**
 * Ensures today's instances exist (idempotent, safe to call on every load —
 * this is the lazy-generation fallback described in the plan, so the Today
 * screen is correct even if the scheduled Edge Function hasn't run yet for
 * this household's timezone), then returns them all for the household.
 */
export function useTodayInstances(householdId: string | undefined) {
  const today = todayDateOnly();

  return useQuery({
    queryKey: ['today-instances', householdId, today],
    enabled: !!householdId,
    queryFn: async (): Promise<ChoreInstanceWithChore[]> => {
      const { error: ensureError } = await supabase.rpc('ensure_todays_instances', {
        p_household_id: householdId!,
        p_for_date: today,
      });
      if (ensureError) throw ensureError;

      const { data, error } = await supabase
        .from('chore_instances')
        .select('*, chores(*), profiles!chore_instances_assigned_to_profiles_fkey(*)')
        .eq('household_id', householdId!)
        .eq('due_date', today);

      if (error) throw error;
      return data as ChoreInstanceWithChore[];
    },
  });
}

export function useChoreInstance(instanceId: string | undefined) {
  return useQuery({
    queryKey: ['chore-instance', instanceId],
    enabled: !!instanceId,
    queryFn: async (): Promise<ChoreInstanceWithChore> => {
      const { data, error } = await supabase
        .from('chore_instances')
        .select('*, chores(*), profiles!chore_instances_assigned_to_profiles_fkey(*)')
        .eq('id', instanceId!)
        .single();

      if (error) throw error;
      return data as ChoreInstanceWithChore;
    },
  });
}

/** This user's subset of today's instances, chore-detail-joined and completion-status sorted. */
export function useMyTodayInstances(householdId: string | undefined) {
  const { session } = useAuth();
  const query = useTodayInstances(householdId);

  const mine = (query.data ?? [])
    .filter((instance) => instance.assigned_to === session?.user.id)
    .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'));

  return { ...query, data: mine };
}

export function useCompleteChoreInstance(householdId: string | undefined) {
  const queryClient = useQueryClient();
  const { session } = useAuth();

  return useMutation({
    mutationFn: async ({ instanceId, photoPath }: { instanceId: string; photoPath: string }) => {
      const { error } = await supabase
        .from('chore_instances')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: session?.user.id,
          photo_path: photoPath,
        })
        .eq('id', instanceId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['today-instances', householdId] });
    },
  });
}
