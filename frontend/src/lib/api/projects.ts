import { api } from '@/lib/http';
import type {
  Level,
  LevelPlanGeometry,
  LevelWorkStatus,
  Paginated,
  Project,
  ProjectStatus,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@/types/api';
import type { ChecklistItem } from '@/types/api';

const base = (companyId: string) => `/v1/companies/${companyId}/projects`;

export interface ProjectFilters {
  status?: ProjectStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ProjectInput {
  name: string;
  code?: string | null;
  description?: string | null;
  status?: ProjectStatus;
  address?: string | null;
  start_date?: string | null;
  planned_end_date?: string | null;
  actual_end_date?: string | null;
}

export interface TaskFilters {
  status?: TaskStatus;
  task_type?: TaskType;
  assigned_user_id?: string;
  level_id?: string;
  limit?: number;
  offset?: number;
}

export const projectsApi = {
  list: (companyId: string, filters: ProjectFilters = {}, signal?: AbortSignal) =>
    api.get<Paginated<Project>>(base(companyId), { ...filters }, signal),
  get: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<Project>(`${base(companyId)}/${projectId}`, undefined, signal),
  create: (companyId: string, input: ProjectInput) =>
    api.post<Project>(base(companyId), input),
  update: (companyId: string, projectId: string, input: Partial<ProjectInput>) =>
    api.patch<Project>(`${base(companyId)}/${projectId}`, input),

  listLevels: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<Paginated<Level> | Level[]>(`${base(companyId)}/${projectId}/levels`, undefined, signal),
  createLevel: (companyId: string, projectId: string, input: LevelInput) =>
    api.post<Level>(`${base(companyId)}/${projectId}/levels`, input),
  updateLevel: (companyId: string, projectId: string, levelId: string, input: Partial<LevelInput>) =>
    api.patch<Level>(`${base(companyId)}/${projectId}/levels/${levelId}`, input),
  initializeLevelChecklist: (companyId: string, projectId: string, levelId: string) =>
    api.post<ChecklistItem[]>(`${base(companyId)}/${projectId}/levels/${levelId}/checklist-template`),

  listTasks: (companyId: string, projectId: string, filters: TaskFilters = {}, signal?: AbortSignal) =>
    api.get<Paginated<Task>>(`${base(companyId)}/${projectId}/tasks`, { ...filters }, signal),
  createTask: (companyId: string, projectId: string, input: TaskInput) =>
    api.post<Task>(`${base(companyId)}/${projectId}/tasks`, input),
  updateTask: (companyId: string, projectId: string, taskId: string, input: Partial<TaskInput>) =>
    api.patch<Task>(`${base(companyId)}/${projectId}/tasks/${taskId}`, input),
};

export interface LevelInput {
  name: string;
  sort_order?: number;
  building_name?: string | null;
  work_status?: LevelWorkStatus;
  concreted_at?: string | null;
  plan_version_id?: string | null;
  plan_page_number?: number | null;
  plan_geometry_json?: LevelPlanGeometry | null;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  task_type: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  level_id?: string | null;
  assigned_user_id?: string | null;
  planned_start_at?: string | null;
  due_at?: string | null;
  location_text?: string | null;
}
