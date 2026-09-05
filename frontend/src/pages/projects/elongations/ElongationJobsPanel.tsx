import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, FileSpreadsheet, ListChecks, ScanLine } from 'lucide-react';
import { useCan } from '@/auth/useCan';
import { elongationsApi } from '@/lib/api/elongations';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ElongationJobV2 } from '@/types/api';
import { ElongationWizard } from './ElongationWizard';

function jobVariant(job: ElongationJobV2): 'destructive' | 'warning' | 'success' | 'muted' {
  if (job.workflow_status.startsWith('failed')) return 'destructive';
  if (job.workflow_status === 'approved' || job.workflow_status === 'exported') return 'success';
  if (job.workflow_status.includes('review') || job.workflow_status === 'measurements_pending') return 'warning';
  return 'muted';
}

function isProcessing(job: ElongationJobV2 | undefined): boolean {
  return Boolean(job && ['queued_theory', 'processing_theory', 'queued_measurements', 'processing_measurements'].includes(job.workflow_status));
}

export function ElongationJobsPanel({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('documents.edit');
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'list' | 'create' | 'job'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: ['elongation-jobs', companyId, projectId],
    queryFn: ({ signal }) => elongationsApi.list(companyId, projectId, signal),
    enabled: mode === 'list',
    refetchInterval: (query) => query.state.data?.some(isProcessing) ? 2500 : false,
    refetchIntervalInBackground: false,
  });
  const selected = useQuery({
    queryKey: ['elongation-job', companyId, projectId, selectedId],
    queryFn: ({ signal }) => elongationsApi.get(companyId, projectId, selectedId as string, signal),
    enabled: mode === 'job' && Boolean(selectedId),
    refetchInterval: (query) => isProcessing(query.state.data) ? 2500 : false,
    refetchIntervalInBackground: false,
  });
  const openJob = (id: string) => {
    setSelectedId(id);
    setMode('job');
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['elongation-jobs', companyId, projectId] });
  };

  if (mode === 'create') {
    return <ElongationWizard companyId={companyId} projectId={projectId} onBack={() => setMode('list')} onCreated={(job) => { refresh(); openJob(job.id); }} />;
  }
  if (mode === 'job') {
    if (selected.isLoading) return <LoadingState label="Cargando trabajo de elongaciones..." />;
    if (selected.isError || !selected.data) return <ErrorState error={selected.error} onRetry={() => void selected.refetch()} />;
    return <ElongationWizard companyId={companyId} projectId={projectId} job={selected.data} onBack={() => setMode('list')} onCreated={(job) => openJob(job.id)} />;
  }
  if (jobs.isLoading) return <LoadingState label="Cargando listas de elongaciones..." />;
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Listas de elongaciones</p>
          <p className="text-sm text-muted-foreground">Plano + plantilla → teoría revisada → mediciones físicas → Excel final versionado.</p>
        </div>
        {canEdit ? <Button onClick={() => setMode('create')}><FilePlus2 /> Nuevo trabajo</Button> : null}
      </div>
      {jobs.data?.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {jobs.data.map((job) => (
            <Card key={job.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{job.title}</p>
                    <p className="text-xs text-muted-foreground">Versión {job.version_number} · tolerancia {job.tolerance_percent}%</p>
                  </div>
                  <Badge variant={jobVariant(job)}>{job.workflow_status.replace(/_/g, ' ')}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-2 text-center text-xs">
                  <span><strong>{job.progress.groups_total}</strong><br />grupos</span>
                  <span><strong>{job.progress.measurements_detected}/{job.progress.measurements_expected}</strong><br />mediciones</span>
                  <span><strong>{job.progress.unresolved_conflicts}</strong><br />conflictos</span>
                </div>
                {job.error_message ? <p className="text-xs text-amber-700">{job.error_message}</p> : null}
                <Button size="sm" variant="outline" onClick={() => openJob(job.id)}><ListChecks /> Abrir asistente</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="Sin listas de elongaciones" description="Cree un trabajo dentro de la obra para revisar teoría, S mediciones y exportar el Excel final." icon={<ScanLine className="h-6 w-6" />} action={canEdit ? <Button onClick={() => setMode('create')}><FileSpreadsheet /> Crear lista</Button> : undefined} />
      )}
    </div>
  );
}
