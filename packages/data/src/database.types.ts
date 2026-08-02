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

// There is no CheckinInterestEnum here any more. `yes` / `maybe` /
// `not_tonight` is the most revealing value in the schema, so it moved inside
// the sealed payload; the type that describes it now is `CheckinInterest` in
// `@couple/core`, where it belongs, because it is no longer a database enum.

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          /** Sealed under the couple's `shared` key. Null until pairing. */
          name_payload: string | null;
          timezone: string;
          locale: LocaleEnum;
          created_at: string;
          updated_at: string;
        };
        // Rows are created by the on_auth_user_created trigger, with nothing
        // in them but the id.
        Insert: never;
        Update: {
          name_payload?: string | null;
          timezone?: string;
          locale?: LocaleEnum;
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
          /** Title, notes and location. */
          payload: string;
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
          // Required, not optional: the payload's AAD binds to the row id, so
          // the client mints it rather than letting gen_random_uuid() do it.
          id: string;
          couple_id: string;
          domain: string;
          kind: string;
          payload: string;
          starts_at?: string | null;
          ends_at?: string | null;
          status?: PlanStatusEnum;
          created_by: string;
          completed_at?: string | null;
          calendar_event_ids?: Json;
        };
        Update: {
          payload?: string;
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
          /** interest, energy and the note. */
          payload: string;
          created_at: string;
          updated_at: string;
        };
        // No client-supplied id: record() upserts on (profile_id, on_date) and
        // Postgres keeps the existing row's id on conflict, which is exactly
        // why this payload's AAD binds to that natural key instead.
        Insert: {
          couple_id: string;
          profile_id: string;
          on_date: string;
          payload: string;
        };
        Update: { payload?: string };
        Relationships: [];
      };
      // 2-2-2-owned. Reachable only through createIdeaRepository.
      plan_ideas: {
        Row: {
          id: string;
          couple_id: string;
          domain: string;
          kind: string;
          /** Title, summary, url, cost band, and the language it is written in. */
          payload: string;
          source: string;
          saved_by: string | null;
          created_at: string;
        };
        Insert: {
          /** Required: the payload's AAD binds to the row id. */
          id: string;
          couple_id: string;
          domain: string;
          kind: string;
          payload: string;
          source: string;
          saved_by?: string | null;
        };
        Update: { payload?: string };
        Relationships: [];
      };
      // Read-only to clients; only the Edge Function's service role writes it.
      ai_usage: {
        Row: { couple_id: string; day: string; request_count: number };
        Insert: { couple_id: string; day: string; request_count?: number };
        Update: { request_count?: number };
        Relationships: [];
      };
      // ------------------------------------------------------ key exchange
      // A public key is replaced, never edited, so there is no Update here and
      // no update grant in the migration either.
      device_keys: {
        Row: { id: string; profile_id: string; public_key: string; created_at: string };
        Insert: { id?: string; profile_id: string; public_key: string };
        Update: never;
        Relationships: [];
      };
      couple_key_wraps: {
        Row: {
          couple_id: string;
          device_key_id: string;
          epoch: number;
          wrapped_key: string;
          wrapped_by: string | null;
          created_at: string;
        };
        Insert: {
          couple_id: string;
          device_key_id: string;
          epoch?: number;
          wrapped_key: string;
          wrapped_by: string;
        };
        Update: never;
        Relationships: [];
      };
      couple_key_recovery: {
        Row: {
          profile_id: string;
          couple_id: string;
          epoch: number;
          kdf: string;
          kdf_salt: string;
          kdf_params: Json;
          wrapped_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          couple_id: string;
          epoch?: number;
          kdf: string;
          kdf_salt: string;
          kdf_params: Json;
          wrapped_key: string;
        };
        Update: { kdf?: string; kdf_salt?: string; kdf_params?: Json; wrapped_key?: string };
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
    };
    CompositeTypes: Record<string, never>;
  };
}
