import { api } from '@/lib/http';
import type {
  PerforationAnnotation,
  PerforationChecklistEntry,
  PerforationColor,
  PerforationDocument,
  PerforationPoint,
  PerforationWorkspace,
  ProjectRubro,
  ProjectRubroObservation,
  RubroFeatureKey,
} from '@/types/api';

const projectBase = (companyId: string, projectId: string) =>
  `/v1/companies/${companyId}/projects/${projectId}`;

const rubroBase = (companyId: string, projectId: string, rubroId: string) =>
  `${projectBase(companyId, projectId)}/rubros/${rubroId}`;

export interface RubroInput {
  name: string;
  description?: string | null;
  feature_keys: RubroFeatureKey[];
}

export interface PerforationColorInput {
  name: string;
  color_hex: string;
  checklist: PerforationChecklistEntry[];
  sort_order?: number;
}

export const rubrosApi = {
  list: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<ProjectRubro[]>(`${projectBase(companyId, projectId)}/rubros`, undefined, signal),
  create: (companyId: string, projectId: string, input: RubroInput) =>
    api.post<ProjectRubro>(`${projectBase(companyId, projectId)}/rubros`, input),
  update: (companyId: string, projectId: string, rubroId: string, input: Partial<Pick<RubroInput, 'name' | 'description'>>) =>
    api.patch<ProjectRubro>(rubroBase(companyId, projectId, rubroId), input),
  remove: (companyId: string, projectId: string, rubroId: string) =>
    api.del<void>(rubroBase(companyId, projectId, rubroId)),
  setFeatures: (
    companyId: string,
    projectId: string,
    rubroId: string,
    featureKeys: RubroFeatureKey[],
  ) => api.put<ProjectRubro>(`${rubroBase(companyId, projectId, rubroId)}/features`, {
    features: featureKeys.map((feature_key) => ({ feature_key })),
  }),
  listObservations: (companyId: string, projectId: string, rubroId: string, signal?: AbortSignal) =>
    api.get<ProjectRubroObservation[]>(`${rubroBase(companyId, projectId, rubroId)}/observations`, undefined, signal),
  createObservation: (companyId: string, projectId: string, rubroId: string, body: string) =>
    api.post<ProjectRubroObservation>(`${rubroBase(companyId, projectId, rubroId)}/observations`, { body }),
  removeObservation: (companyId: string, projectId: string, rubroId: string, observationId: string) =>
    api.del<void>(`${rubroBase(companyId, projectId, rubroId)}/observations/${observationId}`),

  perforationWorkspace: (companyId: string, projectId: string, rubroId: string, signal?: AbortSignal) =>
    api.get<PerforationWorkspace>(`${rubroBase(companyId, projectId, rubroId)}/perforations`, undefined, signal),
  uploadPerforationDocument: (
    companyId: string,
    projectId: string,
    rubroId: string,
    title: string,
    file: File,
  ) => {
    const body = new FormData();
    body.set('title', title);
    body.set('file', file);
    return api.upload<PerforationDocument>(`${rubroBase(companyId, projectId, rubroId)}/perforation-documents`, body);
  },
  removePerforationDocument: (companyId: string, projectId: string, rubroId: string, documentId: string) =>
    api.del<void>(`${rubroBase(companyId, projectId, rubroId)}/perforation-documents/${documentId}`),
  previewPerforationDocument: (companyId: string, projectId: string, rubroId: string, documentId: string, page = 1) =>
    api.blob(`${rubroBase(companyId, projectId, rubroId)}/perforation-documents/${documentId}/preview`, { page }),
  downloadPerforationDocument: (companyId: string, projectId: string, rubroId: string, documentId: string) =>
    api.blob(`${rubroBase(companyId, projectId, rubroId)}/perforation-documents/${documentId}/download`),

  createPerforationColor: (companyId: string, projectId: string, rubroId: string, input: PerforationColorInput) =>
    api.post<PerforationColor>(`${rubroBase(companyId, projectId, rubroId)}/perforation-colors`, input),
  updatePerforationColor: (companyId: string, projectId: string, rubroId: string, colorId: string, input: Partial<PerforationColorInput & { is_active: boolean }>) =>
    api.patch<PerforationColor>(`${rubroBase(companyId, projectId, rubroId)}/perforation-colors/${colorId}`, input),
  removePerforationColor: (companyId: string, projectId: string, rubroId: string, colorId: string) =>
    api.del<void>(`${rubroBase(companyId, projectId, rubroId)}/perforation-colors/${colorId}`),

  createPerforationPoint: (
    companyId: string,
    projectId: string,
    rubroId: string,
    input: {
      document_id: string;
      color_id: string;
      page_number: number;
      x: number;
      y: number;
      diameter?: number;
      label?: string | null;
    },
  ) => api.post<PerforationPoint>(`${rubroBase(companyId, projectId, rubroId)}/perforation-points`, input),
  updatePerforationPoint: (
    companyId: string,
    projectId: string,
    rubroId: string,
    pointId: string,
    input: Partial<{
      color_id: string;
      page_number: number;
      x: number;
      y: number;
      diameter: number;
      label: string | null;
      note_text: string | null;
    }>,
  ) => api.patch<PerforationPoint>(`${rubroBase(companyId, projectId, rubroId)}/perforation-points/${pointId}`, input),
  updatePerforationChecklist: (
    companyId: string,
    projectId: string,
    rubroId: string,
    pointId: string,
    checklist: PerforationChecklistEntry[],
  ) => api.put<PerforationPoint>(`${rubroBase(companyId, projectId, rubroId)}/perforation-points/${pointId}/checklist`, { checklist }),
  uploadPerforationAttachment: (companyId: string, projectId: string, rubroId: string, pointId: string, file: File) => {
    const body = new FormData();
    body.set('file', file);
    return api.upload<PerforationPoint>(`${rubroBase(companyId, projectId, rubroId)}/perforation-points/${pointId}/attachment`, body);
  },
  downloadPerforationAttachment: (companyId: string, projectId: string, rubroId: string, pointId: string) =>
    api.blob(`${rubroBase(companyId, projectId, rubroId)}/perforation-points/${pointId}/attachment`),
  removePerforationPoint: (companyId: string, projectId: string, rubroId: string, pointId: string) =>
    api.del<void>(`${rubroBase(companyId, projectId, rubroId)}/perforation-points/${pointId}`),
  createPerforationAnnotation: (
    companyId: string,
    projectId: string,
    rubroId: string,
    input: {
      document_id: string;
      page_number: number;
      kind: 'line' | 'note';
      points: { x: number; y: number }[];
      text?: string | null;
      color_hex: string;
      stroke_width: number;
      opacity: number;
    },
  ) => api.post<PerforationAnnotation>(`${rubroBase(companyId, projectId, rubroId)}/perforation-annotations`, input),
  removePerforationAnnotation: (companyId: string, projectId: string, rubroId: string, annotationId: string) =>
    api.del<void>(`${rubroBase(companyId, projectId, rubroId)}/perforation-annotations/${annotationId}`),
};
