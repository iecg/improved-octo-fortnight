import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import type { Household, HouseholdMember, Profile } from '@/types';

export interface MembershipWithHousehold extends HouseholdMember {
  households: Household;
}

export interface HouseholdMemberWithProfile extends HouseholdMember {
  profiles: Profile | null;
}

/** The current user's single household membership (MVP: one household per user). */
export function useHousehold() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ['household', session?.user.id],
    enabled: !!session,
    queryFn: async (): Promise<MembershipWithHousehold | null> => {
      const { data, error } = await supabase
        .from('household_members')
        .select('*, households(*)')
        .eq('user_id', session!.user.id)
        .maybeSingle();

      if (error) throw error;
      return data as MembershipWithHousehold | null;
    },
  });
}

export function useHouseholdMembers(householdId: string | undefined) {
  return useQuery({
    queryKey: ['household-members', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<HouseholdMemberWithProfile[]> => {
      const { data, error } = await supabase
        .from('household_members')
        .select('*, profiles(*)')
        .eq('household_id', householdId!)
        .order('position', { ascending: true });

      if (error) throw error;
      return data as HouseholdMemberWithProfile[];
    },
  });
}

export function useInvalidateHousehold() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['household'] });
}

export function useRegenerateInviteCode(householdId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('regenerate_invite_code', {
        p_household_id: householdId!,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household'] });
    },
  });
}

export function useLeaveHousehold() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('household_members')
        .delete()
        .eq('user_id', session!.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household'] });
    },
  });
}
