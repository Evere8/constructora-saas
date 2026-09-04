export type ProjectStatus = 'active' | 'inactive' | 'completed' | 'archived';
export type TaskType = 'work' | 'transport';
export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ChecklistStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'not_applicable';

export type Role =
  | 'platform_admin'
  | 'owner'
  | 'admin'
  | 'engineer'
  | 'supervisor'
  | 'warehouse'
  | 'worker'
  | 'transport'
  | 'viewer';

export interface Membership {
  company_id: string;
  company_name: string;
  company_slug: string;
  company_status: string;
  role: Role;
  membership_status: string;
}

export interface AuthMe {
  id?: string;
  email?: string;
  full_name?: string | null;
  name?: string | null;
  status: string;
  is_platform_admin: boolean;
  memberships: Membership[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Project {
  id: string;
  company_id: string;
  code?: string | null;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  address?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Level {
  id: string;
  project_id: string;
  name: string;
  order?: number | null;
  description?: string | null;
  created_at?: string | null;
}

export interface Task {
  id: string;
  project_id: string;
  level_id?: string | null;
  title: string;
  description?: string | null;
  task_type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_user_id?: string | null;
  due_date?: string | null;
  created_at?: string | null;
}

export interface ChecklistItem {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  process_stage: string;
  status: ChecklistStatus;
  assigned_user_id?: string | null;
  due_date?: string | null;
  created_at?: string | null;
}

export interface ChecklistProgress {
  total: number;
  completed: number;
  in_progress?: number;
  pending?: number;
  blocked?: number;
  not_applicable?: number;
  percent: number;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  limits_json: {
    active_projects?: number;
    users?: number;
    storage_gb?: number;
    monthly_plan_uploads?: number;
    [key: string]: number | string | boolean | undefined;
  };
  is_active: boolean;
  created_at?: string | null;
}

export interface Company {
  id: string;
  name: string;
  slug?: string | null;
  status: string;
  plan_id?: string | null;
  created_at?: string | null;
}

export interface PlatformMembership {
  id: string;
  company_id: string;
  user_id?: string | null;
  email?: string | null;
  full_name?: string | null;
  role: Role;
  status: string;
  invitation_sent?: boolean;
}

export interface CompanyOnboardingResult {
  company: Company;
  owner: PlatformMembership;
}
