import { api } from '@/lib/http';

export interface ProjectFolder { id: string; name: string; parent_id: string | null }
export interface ProjectFile { id: string; folder_id: string | null; original_filename: string; mime_type: string; size_bytes: number; stored_size_bytes: number; storage_encoding: 'identity' | 'gzip'; sha256: string }

const base = (companyId: string, projectId: string) => `/v1/companies/${companyId}/projects/${projectId}`;

export const projectFilesApi = {
  storageStatus: (companyId: string, signal?: AbortSignal) => api.get<{ configured: boolean; message?: string }>(`/v1/companies/${companyId}/project-files/storage-status`, undefined, signal),
  folders: (companyId: string, projectId: string, signal?: AbortSignal) => api.get<ProjectFolder[]>(`${base(companyId, projectId)}/folders`, undefined, signal),
  createFolder: (companyId: string, projectId: string, name: string, parent_id: string | null) => api.post<ProjectFolder>(`${base(companyId, projectId)}/folders`, { name, parent_id }),
  files: async (companyId: string, projectId: string, signal?: AbortSignal, folderId: string | null = null) => {
    const result: ProjectFile[] = [];
    for (;;) {
      const page = await api.get<ProjectFile[]>(`${base(companyId, projectId)}/files`, { folder_id: folderId, offset: result.length, limit: 100 }, signal);
      result.push(...page);
      if (page.length < 100) return result;
    }
  },
  upload: (companyId: string, projectId: string, file: File, folder_id: string | null) => {
    const form = new FormData();
    form.set('file', file);
    if (folder_id) form.set('folder_id', folder_id);
    return api.upload<ProjectFile>(`${base(companyId, projectId)}/files`, form);
  },
  download: (companyId: string, projectId: string, fileId: string) => api.blob(`${base(companyId, projectId)}/files/${fileId}/download`),
};
