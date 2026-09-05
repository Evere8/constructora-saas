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
  planned_end_date?: string | null;
  actual_end_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Level {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
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
  planned_start_at?: string | null;
  due_at?: string | null;
  location_text?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
}

export interface ChecklistItem {
  id: string;
  company_id: string;
  project_id: string;
  task_id?: string | null;
  plan_version_id?: string | null;
  annotation_id?: string | null;
  title: string;
  description?: string | null;
  process_stage: string;
  status: ChecklistStatus;
  assigned_user_id?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
}

export interface ChecklistProgress {
  total: number;
  completed: number;
  in_progress?: number;
  pending?: number;
  blocked?: number;
  not_applicable?: number;
  completion_percent: number;
}

export interface ChecklistEvidence {
  id: string;
  company_id: string;
  project_id: string;
  task_id: string;
  checklist_item_id: string;
  evidence_type: 'photo' | 'document' | 'note';
  note?: string | null;
  original_filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploaded_by_user_id: string;
  created_at: string;
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

export interface PlanVersion {
  id: string;
  document_id: string;
  version_number: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_by_user_id: string;
  created_at: string;
}

export interface PlanDocument {
  id: string;
  company_id: string;
  project_id: string;
  level_id?: string | null;
  title: string;
  status: string;
  created_at: string;
  versions: PlanVersion[];
}

export interface DocumentItem {
  id: string;
  job_id: string;
  label: string;
  classification: 'band' | 'distributed' | 'unknown';
  length_m: string;
  strand_count: number;
  calculated_elongation: string;
  measured_elongation?: string | null;
  confidence?: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
}

export interface DocumentJob {
  id: string;
  company_id: string;
  project_id: string;
  title: string;
  source_kind: string;
  original_filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  status: string;
  tolerance_percent: string;
  error_message?: string | null;
  completed_at?: string | null;
  created_at: string;
  item_count: number;
  items: DocumentItem[];
}

export type ElongationClassification = 'band' | 'distributed' | 'unknown';
export type ElongationReviewStatus = 'pending' | 'approved' | 'rejected' | 'conflict';

export interface ElongationMeasurement {
  id: string;
  job_id: string;
  item_id: string;
  ordinal: number;
  measured_elongation: string | null;
  raw_text: string | null;
  confidence: string | null;
  match_method: 'label_anchor' | 'spatial' | 'manual' | null;
  review_status: ElongationReviewStatus;
  override_reason: string | null;
  source_file_id: string | null;
  source_page: number | null;
  source_location_json: Record<string, unknown> | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  maximum_elongation: string | null;
  minimum_elongation: string | null;
  tolerance_status: 'within' | 'outside' | 'missing' | 'unresolved';
}

export interface ElongationItemV2 {
  id: string;
  job_id: string;
  label: string;
  label_number: number;
  raw_label: string | null;
  raw_text: string | null;
  sort_order: number;
  classification: ElongationClassification;
  length_m: string;
  strand_count: number;
  calculated_elongation: string;
  confidence: string | null;
  theory_review_status: ElongationReviewStatus;
  field_confidence_json: Record<string, unknown> | null;
  source_file_id: string | null;
  source_page: number | null;
  source_location_json: Record<string, unknown> | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  measurements: ElongationMeasurement[];
}

export interface ElongationJobFile {
  id: string;
  job_id: string;
  kind: 'plan' | 'template' | 'measurement_scan' | 'theoretical_export' | 'final_export' | string;
  version_number: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  page_count: number | null;
  processing_status: string;
  processing_summary_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

export interface ElongationClassificationZone {
  id: string;
  job_id: string;
  classification: Exclude<ElongationClassification, 'unknown'>;
  name: string | null;
  geometry_json: {
    page?: number;
    x: string | number;
    y: string | number;
    width: string | number;
    height: string | number;
  };
  created_by_user_id: string;
  created_at: string;
}

export interface ElongationProgress {
  groups_total: number;
  groups_pending: number;
  measurements_expected: number;
  measurements_detected: number;
  measurements_pending: number;
  outside_tolerance: number;
  unresolved_conflicts: number;
  can_approve_theory: boolean;
  can_approve_final: boolean;
  approval_blockers: string[];
}

export interface ElongationJobV2 {
  id: string;
  company_id: string;
  project_id: string;
  level_id: string | null;
  responsible_user_id: string | null;
  plan_version_id: string | null;
  title: string;
  workflow_status: string;
  tolerance_percent: string;
  template_mapping_json: Record<string, unknown> | null;
  processing_summary_json: Record<string, unknown> | null;
  error_message: string | null;
  theory_approved_by_user_id: string | null;
  theory_approved_at: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  version_number: number;
  created_at: string;
  progress: ElongationProgress;
  files: ElongationJobFile[];
  zones: ElongationClassificationZone[];
  items: ElongationItemV2[];
}

export interface InventoryItem {
  id: string;
  company_id: string;
  code: string;
  name: string;
  item_type: 'machine' | 'tool' | 'material';
  unit: string;
  serial_number?: string | null;
  status: 'available' | 'assigned' | 'maintenance' | 'retired';
  current_project_id?: string | null;
  quantity: string;
  created_at: string;
}

export interface InventoryMovement {
  id: string;
  company_id: string;
  item_id: string;
  from_project_id?: string | null;
  to_project_id?: string | null;
  quantity: string;
  condition_status?: string | null;
  notes?: string | null;
  moved_by_user_id: string;
  moved_at: string;
}

export interface CompanyMember {
  id: string;
  user_id: string;
  email: string;
  full_name?: string | null;
  role: Role;
  status: string;
  created_at: string;
  assigned_tasks: number;
  assigned_checklist: number;
  invitation_sent?: boolean;
}

export interface ReportOverview {
  projects_total: number;
  projects_active: number;
  tasks_total: number;
  tasks_completed: number;
  checklist_total: number;
  checklist_completed: number;
  completion_percent: number;
  inventory_total: number;
  inventory_assigned: number;
  members_active: number;
}

export interface CompanySettings {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRequirement {
  id: string;
  task_id: string;
  inventory_item_id?: string | null;
  description: string;
  required_quantity: string;
  unit: string;
  availability_status: 'unchecked' | 'available' | 'partial' | 'missing';
  inventory_code?: string | null;
  inventory_name?: string | null;
}

export interface OperationalNotification {
  id: string;
  company_id: string;
  project_id?: string | null;
  task_id?: string | null;
  checklist_item_id?: string | null;
  requirement_id?: string | null;
  alert_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  due_at?: string | null;
  status: 'unread' | 'read' | 'dismissed';
  created_at: string;
}

export interface NotificationList {
  items: OperationalNotification[];
  unread_count: number;
}

export interface ReportProjectRow {
  project_id: string;
  project_name: string;
  tasks_total: number;
  tasks_completed: number;
  tasks_overdue: number;
  completion_percent: number;
}

export interface ReportAssigneeRow {
  user_id?: string | null;
  name: string;
  tasks_total: number;
  tasks_completed: number;
  tasks_overdue: number;
  completion_percent: number;
}

export interface ReportAdvanced {
  date_from?: string | null;
  date_to?: string | null;
  project_id?: string | null;
  assigned_user_id?: string | null;
  tasks_total: number;
  tasks_completed: number;
  tasks_overdue: number;
  tasks_due_soon: number;
  tasks_unassigned: number;
  checklist_total: number;
  checklist_completed: number;
  checklist_blocked: number;
  requirements_at_risk: number;
  completion_percent: number;
  status_counts: Array<{ status: string; count: number }>;
  projects: ReportProjectRow[];
  assignees: ReportAssigneeRow[];
}
