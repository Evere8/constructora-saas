import { api } from '@/lib/http';
import type {
  ChecklistEvidence,
  ChecklistItem,
  ChecklistProgress,
  ChecklistStatus,
  Paginated,
} from '@/types/api';

const base = (companyId: string, projectId: string) =>
  `/v1/companies/${companyId}/projects/${projectId}/checklist`;

export interface ChecklistFilters {
  status?: ChecklistStatus;
  process_stage?: string;
  assigned_user_id?: string;
  task_id?: string;
  level_id?: string;
  limit?: number;
  offset?: number;
}

export interface ChecklistInput {
  task_id?: string | null;
  level_id?: string | null;
  title: string;
  description?: string | null;
  process_stage: string;
  status?: ChecklistStatus;
  assigned_user_id?: string | null;
  due_at?: string | null;
  performed_on?: string | null;
}

export const checklistApi = {
  list: (companyId: string, projectId: string, filters: ChecklistFilters = {}, signal?: AbortSignal) =>
    api.get<Paginated<ChecklistItem>>(base(companyId, projectId), { ...filters }, signal),
  create: (companyId: string, projectId: string, input: ChecklistInput) =>
    api.post<ChecklistItem>(base(companyId, projectId), input),
  update: (companyId: string, projectId: string, itemId: string, input: Partial<ChecklistInput>) =>
    api.patch<ChecklistItem>(`${base(companyId, projectId)}/${itemId}`, input),
  progress: (
    companyId: string,
    projectId: string,
    filters: Pick<ChecklistFilters, 'task_id' | 'level_id'> = {},
    signal?: AbortSignal,
  ) => api.get<ChecklistProgress>(`${base(companyId, projectId)}/progress`, filters, signal),
  listEvidence: (
    companyId: string,
    projectId: string,
    itemId: string,
    signal?: AbortSignal,
  ) => api.get<ChecklistEvidence[]>(`${base(companyId, projectId)}/${itemId}/evidence`, undefined, signal),
  createEvidence: (
    companyId: string,
    projectId: string,
    itemId: string,
    input: { note?: string; file?: File },
  ) => {
    const form = new FormData();
    if (input.note) form.set('note', input.note);
    if (input.file) form.set('file', input.file);
    return api.upload<ChecklistEvidence>(`${base(companyId, projectId)}/${itemId}/evidence`, form);
  },
  downloadEvidence: (
    companyId: string,
    projectId: string,
    itemId: string,
    evidenceId: string,
  ) => api.blob(`${base(companyId, projectId)}/${itemId}/evidence/${evidenceId}/file`),
};
