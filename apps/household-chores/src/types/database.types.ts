// Hand-authored to mirror supabase/migrations/*.sql.
//
// Once this project is linked to a real Supabase project, regenerate the
// authoritative version with:
//   npx supabase gen types typescript --linked > src/types/database.types.ts
// and re-apply any manual edits below if the generator's shape differs.
//
// `Relationships: []` on every table and `Views: {}` on the schema are
// required by supabase-js's GenericSchema/GenericTable constraints even
// though we don't use them here — omitting them makes every query/mutation
// argument silently type as `never`.

export type CadenceType = 'daily' | 'weekly_days' | 'every_n_days' | 'monthly';
export type AssignmentType = 'fixed' | 'rotating';
export type InstanceStatus = 'pending' | 'completed' | 'missed';
export type HouseholdRole = 'owner' | 'member';

export type CadenceConfig =
  Record<string, never> | { weekdays: number[] } | { n: number } | { day_of_month: number };

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      push_tokens: {
        Row: {
          id: string;
          user_id: string;
          token: string;
          device_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['push_tokens']['Row']> & {
          user_id: string;
          token: string;
        };
        Update: Partial<Database['public']['Tables']['push_tokens']['Row']>;
        Relationships: [];
      };
      households: {
        Row: {
          id: string;
          name: string;
          invite_code: string;
          timezone: string;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['households']['Row']> & { name: string };
        Update: Partial<Database['public']['Tables']['households']['Row']>;
        Relationships: [];
      };
      household_members: {
        Row: {
          id: string;
          household_id: string;
          user_id: string;
          role: HouseholdRole;
          position: number;
          joined_at: string;
        };
        Insert: Partial<Database['public']['Tables']['household_members']['Row']> & {
          household_id: string;
          user_id: string;
          position: number;
        };
        Update: Partial<Database['public']['Tables']['household_members']['Row']>;
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_members_user_id_profiles_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      chores: {
        Row: {
          id: string;
          household_id: string;
          title: string;
          description: string | null;
          icon: string | null;
          cadence_type: CadenceType;
          cadence_config: CadenceConfig;
          start_date: string;
          assignment_type: AssignmentType;
          fixed_assignee_id: string | null;
          active: boolean;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['chores']['Row']> & {
          household_id: string;
          title: string;
          cadence_type: CadenceType;
          created_by: string;
        };
        Update: Partial<Database['public']['Tables']['chores']['Row']>;
        Relationships: [
          {
            foreignKeyName: 'chores_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chores_fixed_assignee_id_profiles_fkey';
            columns: ['fixed_assignee_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      chore_rotation_state: {
        Row: {
          chore_id: string;
          next_position: number;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['chore_rotation_state']['Row']> & {
          chore_id: string;
        };
        Update: Partial<Database['public']['Tables']['chore_rotation_state']['Row']>;
        Relationships: [
          {
            foreignKeyName: 'chore_rotation_state_chore_id_fkey';
            columns: ['chore_id'];
            isOneToOne: true;
            referencedRelation: 'chores';
            referencedColumns: ['id'];
          },
        ];
      };
      chore_instances: {
        Row: {
          id: string;
          chore_id: string;
          household_id: string;
          due_date: string;
          assigned_to: string;
          status: InstanceStatus;
          completed_at: string | null;
          completed_by: string | null;
          photo_path: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['chore_instances']['Row']> & {
          chore_id: string;
          household_id: string;
          due_date: string;
          assigned_to: string;
        };
        Update: Partial<Database['public']['Tables']['chore_instances']['Row']>;
        Relationships: [
          {
            foreignKeyName: 'chore_instances_chore_id_fkey';
            columns: ['chore_id'];
            isOneToOne: false;
            referencedRelation: 'chores';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chore_instances_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chore_instances_assigned_to_profiles_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chore_instances_completed_by_profiles_fkey';
            columns: ['completed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_household: {
        Args: { p_name: string; p_timezone?: string };
        Returns: Database['public']['Tables']['households']['Row'];
      };
      join_household_by_code: {
        Args: { p_code: string };
        Returns: Database['public']['Tables']['households']['Row'];
      };
      regenerate_invite_code: {
        Args: { p_household_id: string };
        Returns: string;
      };
      ensure_todays_instances: {
        Args: { p_household_id: string; p_for_date?: string };
        Returns: Database['public']['Tables']['chore_instances']['Row'][];
      };
    };
  };
}
