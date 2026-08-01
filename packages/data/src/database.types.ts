/**
 * Database types.
 *
 * Hand-written to match `supabase/migrations`. Once the Supabase CLI is
 * available locally, `npm run db:types` regenerates this file from the live
 * schema and it should be treated as generated output from then on.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type LocaleEnum = 'en' | 'es';
export type IntervalUnitEnum = 'day' | 'week' | 'month' | 'year';
export type PlanStatusEnum =
  'idea' | 'proposed' | 'scheduled' | 'completed' | 'skipped' | 'declined';
export type ProposalResponseEnum = 'pending' | 'accepted' | 'declined' | 'countered';
export type CheckinInterestEnum = 'yes' | 'maybe' | 'not_tonight';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          timezone: string;
          locale: LocaleEnum;
          expo_push_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          timezone?: string;
          locale?: LocaleEnum;
          expo_push_token?: string | null;
        };
        Update: {
          display_name?: string | null;
          timezone?: string;
          locale?: LocaleEnum;
          expo_push_token?: string | null;
        };
        Relationships: [];
      };
      couples: {
        Row: {
          id: string;
          invite_code: string;
          anniversary_date: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        // Only these two columns are grantable; see the column-level grant in
        // the RLS migration.
        Update: { anniversary_date?: string | null; timezone?: string };
        Relationships: [];
      };
      couple_members: {
        Row: { couple_id: string; profile_id: string; joined_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      cadences: {
        Row: {
          id: string;
          couple_id: string;
          domain: string;
          kind: string;
          interval_value: number;
          interval_unit: IntervalUnitEnum;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          domain: string;
          kind: string;
          interval_value: number;
          interval_unit: IntervalUnitEnum;
          enabled?: boolean;
        };
        Update: {
          interval_value?: number;
          interval_unit?: IntervalUnitEnum;
          enabled?: boolean;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          couple_id: string;
          domain: string;
          kind: string;
          title: string | null;
          notes: string | null;
          location: string | null;
          starts_at: string | null;
          ends_at: string | null;
          status: PlanStatusEnum;
          created_by: string | null;
          completed_at: string | null;
          calendar_event_ids: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          domain: string;
          kind: string;
          title?: string | null;
          notes?: string | null;
          location?: string | null;
          starts_at?: string | null;
          ends_at?: string | null;
          status?: PlanStatusEnum;
          created_by: string;
          completed_at?: string | null;
          calendar_event_ids?: Json;
        };
        Update: {
          title?: string | null;
          notes?: string | null;
          location?: string | null;
          starts_at?: string | null;
          ends_at?: string | null;
          status?: PlanStatusEnum;
          completed_at?: string | null;
          calendar_event_ids?: Json;
        };
        Relationships: [];
      };
      plan_proposals: {
        Row: {
          id: string;
          plan_id: string;
          couple_id: string;
          proposed_by: string;
          starts_at: string;
          ends_at: string;
          response: ProposalResponseEnum;
          responded_at: string | null;
          responded_by: string | null;
          countered_from: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          couple_id: string;
          proposed_by: string;
          starts_at: string;
          ends_at: string;
          countered_from?: string | null;
        };
        // responded_by / responded_at are stamped by a trigger.
        Update: { response?: ProposalResponseEnum };
        Relationships: [];
      };
      checkins: {
        Row: {
          id: string;
          couple_id: string;
          profile_id: string;
          on_date: string;
          interest: CheckinInterestEnum;
          energy: number | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          profile_id: string;
          on_date: string;
          interest: CheckinInterestEnum;
          energy?: number | null;
          note?: string | null;
        };
        Update: {
          interest?: CheckinInterestEnum;
          energy?: number | null;
          note?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_couple: {
        Args: { p_timezone: string };
        Returns: Database['public']['Tables']['couples']['Row'];
      };
      join_couple: {
        Args: { p_code: string };
        Returns: { ok: true; couple_id: string } | { ok: false; reason: string };
      };
      current_couple_id: { Args: Record<string, never>; Returns: string | null };
      is_couple_member: { Args: { target: string }; Returns: boolean };
    };
    Enums: {
      locale: LocaleEnum;
      interval_unit: IntervalUnitEnum;
      plan_status: PlanStatusEnum;
      proposal_response: ProposalResponseEnum;
      checkin_interest: CheckinInterestEnum;
    };
    CompositeTypes: Record<string, never>;
  };
}
