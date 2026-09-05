import { api } from '@/lib/http';
import type {
  ElongationClassification,
  ElongationClassificationZone,
  ElongationItemV2,
  ElongationJobV2,
  ElongationMeasurement,
  ElongationReviewStatus,
} from '@/types/api';

const base = (companyId: string, projectId: string) =>
  `/v1/companies/${companyId}/projects/${projectId}/elongation-jobs`;

export interface ElongationJobInput {
  title: string;
  planFile?: File | null;
  planVersionId?: string | null;
  templateFile: File;
  levelId?: string | null;
  responsibleUserId?: string | null;
}

export type ElongationItemPatch = Partial<
  Pick<
    ElongationItemV2,
    'label' | 'classification' | 'length_m' | 'strand_count' | 'calculated_elongation' | 'theory_review_status'
  >
>;

export type ElongationMeasurementPatch = Partial<
  Pick<
    ElongationMeasurement,
    'ordinal' | 'measured_elongation' | 'raw_text' | 'match_method' | 'review_status' | 'override_reason'
  >
>;

function creationForm(input: ElongationJobInput): FormData {
  const body = new FormData();
  body.set('title', input.title);
  body.set('template_file', input.templateFile);
  if (input.planFile) body.set('plan_file', input.planFile);
  if (input.planVersionId) body.set('plan_version_id', input.planVersionId);
  if (input.levelId) body.set('level_id', input.levelId);
  if (input.responsibleUserId) body.set('responsible_user_id', input.responsibleUserId);
  return body;
}

export const elongationsApi = {
  list: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<ElongationJobV2[]>(base(companyId, projectId), undefined, signal),
  get: (companyId: string, projectId: string, jobId: string, signal?: AbortSignal) =>
    api.get<ElongationJobV2>(`${base(companyId, projectId)}/${jobId}`, undefined, signal),
  create: (companyId: string, projectId: string, input: ElongationJobInput) =>
    api.upload<ElongationJobV2>(base(companyId, projectId), creationForm(input)),
  retry: (companyId: string, projectId: string, jobId: string) =>
    api.post<ElongationJobV2>(`${base(companyId, projectId)}/${jobId}/retry`),
  updateItem: (
    companyId: string,
    projectId: string,
    jobId: string,
    itemId: string,
    input: ElongationItemPatch,
  ) => api.patch<ElongationItemV2>(`${base(companyId, projectId)}/${jobId}/items/${itemId}`, input),
  classify: (companyId: string, projectId: string, jobId: string, itemIds: string[], classification: Exclude<ElongationClassification, 'unknown'>) =>
    api.post<ElongationJobV2>(`${base(companyId, projectId)}/${jobId}/classify`, { item_ids: itemIds, classification }),
  createZone: (
    companyId: string,
    projectId: string,
    jobId: string,
    input: {
      classification: Exclude<ElongationClassification, 'unknown'>;
      name?: string;
      geometry: ElongationClassificationZone['geometry_json'];
    },
  ) => api.post<ElongationJobV2>(`${base(companyId, projectId)}/${jobId}/classification-zones`, input),
  deleteZone: (companyId: string, projectId: string, jobId: string, zoneId: string) =>
    api.del<void>(`${base(companyId, projectId)}/${jobId}/classification-zones/${zoneId}`),
  approveTheory: (companyId: string, projectId: string, jobId: string) =>
    api.post<ElongationJobV2>(`${base(companyId, projectId)}/${jobId}/approve-theory`),
  uploadMeasurements: (companyId: string, projectId: string, jobId: string, files: File[]) => {
    const body = new FormData();
    files.forEach((file) => body.append('files', file));
    return api.upload<ElongationJobV2>(`${base(companyId, projectId)}/${jobId}/measurement-files`, body);
  },
  updateMeasurement: (
    companyId: string,
    projectId: string,
    jobId: string,
    measurementId: string,
    input: ElongationMeasurementPatch,
  ) => api.patch<ElongationMeasurement>(`${base(companyId, projectId)}/${jobId}/measurements/${measurementId}`, input),
  approveFinal: (companyId: string, projectId: string, jobId: string) =>
    api.post<ElongationJobV2>(`${base(companyId, projectId)}/${jobId}/approve-final`),
  file: (companyId: string, projectId: string, jobId: string, fileId: string) =>
    api.blob(`${base(companyId, projectId)}/${jobId}/files/${fileId}`),
  preview: (companyId: string, projectId: string, jobId: string, fileId: string, page = 1) =>
    api.blob(`${base(companyId, projectId)}/${jobId}/files/${fileId}/preview?page=${page}`),
  theoreticalExport: (companyId: string, projectId: string, jobId: string) =>
    api.blob(`${base(companyId, projectId)}/${jobId}/exports/theoretical`),
  finalExport: (companyId: string, projectId: string, jobId: string) =>
    api.blob(`${base(companyId, projectId)}/${jobId}/exports/final`),
};

export const elongationLabels: Record<ElongationClassification, string> = {
  band: 'Banda',
  distributed: 'Distribuido',
  unknown: 'Sin clasificar',
};

export const reviewLabels: Record<ElongationReviewStatus, string> = {
  pending: 'Pendiente',
  approved: 'Revisado',
  rejected: 'Rechazado',
  conflict: 'Conflicto',
};
