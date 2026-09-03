import { api } from '@/lib/http';
import type { ChecklistItem, ChecklistProgress, ChecklistStatus, Paginated } from '@/types/api';

const base = (companyId: string, projectId: string) =>
  `/v1/companies/${companyId}/projects/${projectId}/checklist`;

export interface ChecklistFilters {
  status?: ChecklistStatus;
  process_stage?: string;
  assigned_user_id?: string;
  limit?: number;
  offset?: number;
}

export interface ChecklistInput {
  title: string;
  description?: string | null;
  process_stage: string;
  status?: ChecklistStatus;
  assigned_user_id?: string | null;
  due_date?: string | null;
}

export const checklistApi = {
  list: (companyId: string, projectId: string, filters: ChecklistFilters = {}, signal?: AbortSignal) =>
    api.get<Paginated<ChecklistItem>>(base(companyId, projectId), { ...filters }, signal),
  create: (companyId: string, projectId: string, input: ChecklistInput) =>
    api.post<ChecklistItem>(base(companyId, projectId), input),
  update: (companyId: string, projectId: string, itemId: string, input: Partial<ChecklistInput>) =>
    api.patch<ChecklistItem>(`${base(companyId, projectId)}/${itemId}`, input),
  progress: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<ChecklistProgress>(`${base(companyId, projectId)}/progress`, undefined, signal),
};
