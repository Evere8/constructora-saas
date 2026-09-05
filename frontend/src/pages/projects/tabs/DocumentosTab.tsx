import { ElongationJobsPanel } from '@/pages/projects/elongations/ElongationJobsPanel';

/**
 * V2 intentionally stops using the generic legacy /documents interface.
 * The legacy API remains mounted for existing clients and historic jobs, while every new
 * elongation workflow starts from the traceable assistant below.
 */
export function DocumentosTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  return <ElongationJobsPanel companyId={companyId} projectId={projectId} />;
}
