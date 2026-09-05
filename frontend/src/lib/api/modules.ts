import { api } from '@/lib/http';
import type {
  CompanyMember,
  CompanySettings,
  DocumentItem,
  DocumentJob,
  InventoryItem,
  InventoryMovement,
  NotificationList,
  PlanDocument,
  PlanAnnotation,
  ReportOverview,
  ReportAdvanced,
  Role,
  TaskRequirement,
} from '@/types/api';
import type { QueryParams } from '@/lib/http';

const companyBase = (companyId: string) => `/v1/companies/${companyId}`;
const projectBase = (companyId: string, projectId: string) =>
  `${companyBase(companyId)}/projects/${projectId}`;

function planForm(title: string, file: File, levelId?: string | null): FormData {
  const body = new FormData();
  body.set('title', title);
  body.set('file', file);
  if (levelId) body.set('level_id', levelId);
  return body;
}

function documentForm(title: string, file: File, tolerancePercent: number): FormData {
  const body = new FormData();
  body.set('title', title);
  body.set('file', file);
  body.set('tolerance_percent', String(tolerancePercent));
  return body;
}

export const plansApi = {
  list: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<PlanDocument[]>(`${projectBase(companyId, projectId)}/plans`, undefined, signal),
  create: (companyId: string, projectId: string, title: string, file: File, levelId?: string | null) =>
    api.upload<PlanDocument>(`${projectBase(companyId, projectId)}/plans`, planForm(title, file, levelId)),
  addVersion: (companyId: string, projectId: string, documentId: string, file: File) => {
    const body = new FormData();
    body.set('file', file);
    return api.upload(`${projectBase(companyId, projectId)}/plans/${documentId}/versions`, body);
  },
  download: (companyId: string, projectId: string, versionId: string) =>
    api.blob(`${projectBase(companyId, projectId)}/plans/versions/${versionId}/download`),
  preview: (companyId: string, projectId: string, versionId: string, page = 1) =>
    api.blob(`${projectBase(companyId, projectId)}/plans/versions/${versionId}/preview`, { page }),
  setOverview: (companyId: string, projectId: string, planVersionId: string | null) =>
    api.patch<{ plan_version_id: string | null }>(
      `${projectBase(companyId, projectId)}/plans/overview`,
      { plan_version_id: planVersionId },
    ),
  listAnnotations: (companyId: string, projectId: string, versionId: string, signal?: AbortSignal) =>
    api.get<PlanAnnotation[]>(
      `${projectBase(companyId, projectId)}/plans/versions/${versionId}/annotations`,
      undefined,
      signal,
    ),
  createAnnotation: (
    companyId: string,
    projectId: string,
    versionId: string,
    input: {
      page_number: number;
      level_id?: string | null;
      annotation_type: PlanAnnotation['annotation_type'];
      geometry_json: Record<string, unknown>;
      style_json?: Record<string, unknown>;
      comment?: string | null;
    },
  ) => api.post<PlanAnnotation>(`${projectBase(companyId, projectId)}/plans/versions/${versionId}/annotations`, input),
  deleteAnnotation: (companyId: string, projectId: string, annotationId: string) =>
    api.del<void>(`${projectBase(companyId, projectId)}/plans/annotations/${annotationId}`),
};

export const documentsApi = {
  list: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<DocumentJob[]>(`${projectBase(companyId, projectId)}/documents`, undefined, signal),
  process: (companyId: string, projectId: string, title: string, file: File, tolerancePercent = 7) =>
    api.upload<DocumentJob>(
      `${projectBase(companyId, projectId)}/documents`,
      documentForm(title, file, tolerancePercent),
    ),
  get: (companyId: string, projectId: string, jobId: string, signal?: AbortSignal) =>
    api.get<DocumentJob>(`${projectBase(companyId, projectId)}/documents/${jobId}`, undefined, signal),
  createItem: (
    companyId: string,
    projectId: string,
    jobId: string,
    input: {
      label: string;
      classification: 'band' | 'distributed';
      length_m: number;
      strand_count: number;
      calculated_elongation: number;
    },
  ) => api.post<DocumentItem>(`${projectBase(companyId, projectId)}/documents/${jobId}/items`, input),
  updateItem: (
    companyId: string,
    projectId: string,
    jobId: string,
    itemId: string,
    input: Partial<DocumentItem>,
  ) => api.patch<DocumentItem>(`${projectBase(companyId, projectId)}/documents/${jobId}/items/${itemId}`, input),
  source: (companyId: string, projectId: string, jobId: string) =>
    api.blob(`${projectBase(companyId, projectId)}/documents/${jobId}/source`),
  excel: (companyId: string, projectId: string, jobId: string) =>
    api.blob(`${projectBase(companyId, projectId)}/documents/${jobId}/excel`),
};

export interface InventoryInput {
  code: string;
  name: string;
  item_type: InventoryItem['item_type'];
  unit: string;
  serial_number?: string | null;
  quantity: number;
}

export const inventoryApi = {
  list: (companyId: string, signal?: AbortSignal) =>
    api.get<InventoryItem[]>(`${companyBase(companyId)}/inventory`, undefined, signal),
  create: (companyId: string, input: InventoryInput) =>
    api.post<InventoryItem>(`${companyBase(companyId)}/inventory`, input),
  move: (companyId: string, input: { item_id: string; to_project_id?: string | null; quantity: number; notes?: string }) =>
    api.post<InventoryMovement>(`${companyBase(companyId)}/inventory/movements`, input),
};

export const membersApi = {
  list: (companyId: string, signal?: AbortSignal) =>
    api.get<CompanyMember[]>(`${companyBase(companyId)}/members`, undefined, signal),
  create: (companyId: string, input: { email: string; full_name?: string; role: Role }) =>
    api.post<CompanyMember>(`${companyBase(companyId)}/members`, input),
  update: (companyId: string, membershipId: string, input: { role?: Role; status?: string }) =>
    api.patch<CompanyMember>(`${companyBase(companyId)}/members/${membershipId}`, input),
};

export const reportsApi = {
  overview: (companyId: string, signal?: AbortSignal) =>
    api.get<ReportOverview>(`${companyBase(companyId)}/reports/overview`, undefined, signal),
  advanced: (companyId: string, filters: QueryParams, signal?: AbortSignal) =>
    api.get<ReportAdvanced>(`${companyBase(companyId)}/reports/advanced`, filters, signal),
  csv: (companyId: string, filters: QueryParams) =>
    api.blob(`${companyBase(companyId)}/reports/advanced.csv`, filters),
};

export interface TaskRequirementInput {
  inventory_item_id?: string | null;
  description: string;
  required_quantity: number;
  unit: string;
  availability_status?: TaskRequirement['availability_status'];
}

export const requirementsApi = {
  list: (companyId: string, projectId: string, taskId: string, signal?: AbortSignal) =>
    api.get<TaskRequirement[]>(
      `${projectBase(companyId, projectId)}/tasks/${taskId}/requirements`,
      undefined,
      signal,
    ),
  create: (companyId: string, projectId: string, taskId: string, input: TaskRequirementInput) =>
    api.post<TaskRequirement>(
      `${projectBase(companyId, projectId)}/tasks/${taskId}/requirements`,
      input,
    ),
  update: (
    companyId: string,
    projectId: string,
    taskId: string,
    requirementId: string,
    input: Partial<TaskRequirementInput>,
  ) => api.patch<TaskRequirement>(
    `${projectBase(companyId, projectId)}/tasks/${taskId}/requirements/${requirementId}`,
    input,
  ),
  remove: (companyId: string, projectId: string, taskId: string, requirementId: string) =>
    api.del<void>(
      `${projectBase(companyId, projectId)}/tasks/${taskId}/requirements/${requirementId}`,
    ),
};

export const notificationsApi = {
  list: (companyId: string, signal?: AbortSignal) =>
    api.get<NotificationList>(`${companyBase(companyId)}/notifications`, undefined, signal),
  update: (
    companyId: string,
    notificationId: string,
    status: 'unread' | 'read' | 'dismissed',
  ) => api.patch(`${companyBase(companyId)}/notifications/${notificationId}`, { status }),
};

export const settingsApi = {
  get: (companyId: string, signal?: AbortSignal) =>
    api.get<CompanySettings>(`${companyBase(companyId)}/settings`, undefined, signal),
  update: (companyId: string, input: { name: string }) =>
    api.patch<CompanySettings>(`${companyBase(companyId)}/settings`, input),
};

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
