import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Chore, ChoreInstance, Profile } from '@/types';

export interface ChoreHistoryInstance extends ChoreInstance {
  profiles: Profile | null; // the completer's profile
}

export function useChores(householdId: string | undefined) {
  return useQuery({
    queryKey: ['chores', householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chores')
        .select('*')
        .eq('household_id', householdId!)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });
}

export function useChore(choreId: string | undefined) {
  return useQuery({
    queryKey: ['chore', choreId],
    enabled: !!choreId,
    queryFn: async () => {
      const { data, error } = await supabase.from('chores').select('*').eq('id', choreId!).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useChoreHistory(choreId: string | undefined) {
  return useQuery({
    queryKey: ['chore-history', choreId],
    enabled: !!choreId,
    queryFn: async (): Promise<ChoreHistoryInstance[]> => {
      const { data, error } = await supabase
        .from('chore_instances')
        .select('*, profiles!chore_instances_completed_by_profiles_fkey(*)')
        .eq('chore_id', choreId!)
        .order('due_date', { ascending: false })
        .limit(30);

      if (error) throw error;
      return data as ChoreHistoryInstance[];
    },
  });
}

export function useUpsertChore(householdId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (chore: Partial<Chore> & { id?: string }) => {
      if (chore.id) {
        const { id, ...updates } = chore;
        const { error } = await supabase.from('chores').update(updates).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('chores').insert(chore as Chore);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chores', householdId] });
      queryClient.invalidateQueries({ queryKey: ['today-instances'] });
    },
  });
}

export function useDeactivateChore(householdId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (choreId: string) => {
      const { error } = await supabase.from('chores').update({ active: false }).eq('id', choreId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chores', householdId] });
    },
  });
}
