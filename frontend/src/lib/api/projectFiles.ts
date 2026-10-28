import { api } from '@/lib/http';

export interface ProjectFolder { id: string; name: string; parent_id: string | null }
export interface ProjectFile { id: string; folder_id: string | null; original_filename: string; mime_type: string; size_bytes: number; sha256: string }

const base = (companyId: string, projectId: string) => `/v1/companies/${companyId}/projects/${projectId}`;

export const projectFilesApi = {
  folders: (companyId: string, projectId: string, signal?: AbortSignal) => api.get<ProjectFolder[]>(`${base(companyId, projectId)}/folders`, undefined, signal),
  createFolder: (companyId: string, projectId: string, name: string, parent_id: string | null) => api.post<ProjectFolder>(`${base(companyId, projectId)}/folders`, { name, parent_id }),
  files: (companyId: string, projectId: string, signal?: AbortSignal) => api.get<ProjectFile[]>(`${base(companyId, projectId)}/files`, undefined, signal),
  upload: (companyId: string, projectId: string, file: File, folder_id: string | null) => {
    const form = new FormData();
    form.set('file', file);
    if (folder_id) form.set('folder_id', folder_id);
    return api.upload<ProjectFile>(`${base(companyId, projectId)}/files`, form);
  },
  download: (companyId: string, projectId: string, fileId: string) => api.blob(`${base(companyId, projectId)}/files/${fileId}/download`),
};
