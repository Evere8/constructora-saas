import { api } from '@/lib/http';
import type {
  DailyTask,
  DailyTaskStatus,
  DailyTaskTemplate,
  TaskTemplate,
  TaskType,
  TaskPriority,
} from '@/types/api';

const base = (companyId: string) => `/v1/companies/${companyId}`;

export interface TemplateResourceInput {
  inventory_item_id?: string | null;
  description: string;
  required_quantity: number;
  unit: string;
  sort_order?: number;
}

export interface TemplateChecklistInput {
  title: string;
  description?: string | null;
  sort_order?: number;
}

export interface TaskTemplateInput {
  title: string;
  description?: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  default_location_text?: string | null;
  is_active?: boolean;
  resources?: TemplateResourceInput[];
  checklist_items?: TemplateChecklistInput[];
}

export interface DailyTaskInput {
  title: string;
  description?: string | null;
  assigned_user_id?: string | null;
  task_date?: string;
  checklist_items?: TemplateChecklistInput[];
  save_as_template?: boolean;
  auto_renew_daily?: boolean;
}

export const taskLibraryApi = {
  listTemplates: (companyId: string, activeOnly = true, signal?: AbortSignal) =>
    api.get<TaskTemplate[]>(`${base(companyId)}/task-templates`, { active_only: activeOnly }, signal),
  createTemplate: (companyId: string, input: TaskTemplateInput) =>
    api.post<TaskTemplate>(`${base(companyId)}/task-templates`, input),
  updateTemplate: (companyId: string, templateId: string, input: Partial<TaskTemplateInput>) =>
    api.patch<TaskTemplate>(`${base(companyId)}/task-templates/${templateId}`, input),
  deleteTemplate: (companyId: string, templateId: string) =>
    api.del<void>(`${base(companyId)}/task-templates/${templateId}`),

  listDailyTasks: (
    companyId: string,
    filters: { task_date?: string; assigned_user_id?: string } = {},
    signal?: AbortSignal,
  ) => api.get<DailyTask[]>(`${base(companyId)}/daily-tasks`, filters, signal),
  createDailyTask: (companyId: string, input: DailyTaskInput) =>
    api.post<DailyTask>(`${base(companyId)}/daily-tasks`, input),
  updateDailyTask: (
    companyId: string,
    taskId: string,
    input: Partial<Pick<DailyTask, 'title' | 'description' | 'status'>>,
  ) => api.patch<DailyTask>(`${base(companyId)}/daily-tasks/${taskId}`, input),
  updateDailyChecklist: (
    companyId: string,
    taskId: string,
    itemId: string,
    status: DailyTaskStatus,
  ) => api.patch<DailyTask>(`${base(companyId)}/daily-tasks/${taskId}/checklist/${itemId}`, { status }),
  deleteDailyTask: (companyId: string, taskId: string) =>
    api.del<void>(`${base(companyId)}/daily-tasks/${taskId}`),
  listDailyTemplates: (companyId: string, assignedUserId?: string, signal?: AbortSignal) =>
    api.get<DailyTaskTemplate[]>(
      `${base(companyId)}/daily-task-templates`,
      { assigned_user_id: assignedUserId },
      signal,
    ),
  updateDailyTemplate: (
    companyId: string,
    templateId: string,
    input: Partial<{
      title: string;
      description: string | null;
      auto_renew_daily: boolean;
      is_active: boolean;
      checklist_items: TemplateChecklistInput[];
    }>,
  ) => api.patch<DailyTaskTemplate>(`${base(companyId)}/daily-task-templates/${templateId}`, input),
  deleteDailyTemplate: (companyId: string, templateId: string) =>
    api.del<void>(`${base(companyId)}/daily-task-templates/${templateId}`),
};
