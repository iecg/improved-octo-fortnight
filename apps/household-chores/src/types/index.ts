import type { Database } from './database.types';

export type {
  CadenceType,
  CadenceConfig,
  AssignmentType,
  InstanceStatus,
  HouseholdRole,
  Database,
} from './database.types';

type Tables = Database['public']['Tables'];

export type Chore = Tables['chores']['Row'];
export type ChoreInstance = Tables['chore_instances']['Row'];
export type Household = Tables['households']['Row'];
export type HouseholdMember = Tables['household_members']['Row'];
export type Profile = Tables['profiles']['Row'];

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
