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
  name: string;
  slug: string;
  status: string;
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
  name: string;
  slug?: string | null;
  description?: string | null;
  price?: number | null;
  max_projects?: number | null;
  max_users?: number | null;
  is_active?: boolean;
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
  role: Role;
  status: string;
}
