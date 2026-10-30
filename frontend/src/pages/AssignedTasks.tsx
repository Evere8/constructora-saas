import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { taskLibraryApi, type AssignedTask } from '@/lib/api/taskLibrary';
import { projectsApi } from '@/lib/api/projects';
import { TASK_STATUS_OPTIONS } from '@/lib/labels';
import type { TaskStatus } from '@/types/api';
import { TaskWorkspaceDialog } from '@/pages/projects/TaskWorkspaceDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/common/states';

export function AssignedTasks({ companyId }: { companyId: string }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AssignedTask | null>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['my-work-tasks', companyId, offset],
    queryFn: ({ signal }) => taskLibraryApi.myWork(companyId, offset, signal),
    refetchInterval: 30_000,
  });
  const status = useMutation({
    mutationFn: ({ task, value }: { task: AssignedTask; value: TaskStatus }) => projectsApi.updateTask(companyId, task.project_id, task.id, { status: value }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['my-work-tasks', companyId] });
      void client.invalidateQueries({ queryKey: ['my-tasks-summary', companyId] });
      void client.invalidateQueries({ queryKey: ['tasks', companyId] });
      toast.success('Tarea actualizada');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return <Card className={query.data?.total ? 'border-orange-400' : ''}><CardContent className="space-y-3 p-4">
    <h2 className="text-lg font-semibold">Mis tareas de obra pendientes ({query.data?.total ?? '…'})</h2>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data.items.length ? query.data.items.map((task) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div><p className="font-medium">{task.title}</p><p className="text-sm text-muted-foreground">{[task.project_name, task.sector_name, task.level_name].filter(Boolean).join(' · ')}</p></div>
      <div className="flex gap-2"><select aria-label={`Estado de ${task.title}`} className="rounded-md border bg-background px-2 text-sm" value={task.status} disabled={status.isPending} onChange={(event) => status.mutate({ task, value: event.target.value as TaskStatus })}>{TASK_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Button variant="outline" onClick={() => setSelected(task)}>Abrir tarea</Button></div>
    </div>) : <p className="text-sm text-muted-foreground">No tienes tareas de obra pendientes en esta página.</p>}
    <div className="flex gap-2"><Button variant="outline" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 30))}>Anterior</Button><Button variant="outline" disabled={query.isFetching || offset + 30 >= (query.data?.total ?? 0)} onClick={() => setOffset(offset + 30)}>Siguiente</Button></div>
    {selected ? <TaskWorkspaceDialog companyId={companyId} projectId={selected.project_id} task={selected} levelName={selected.level_name ?? selected.project_name} open onOpenChange={(open) => { if (!open) setSelected(null); }} /> : null}
  </CardContent></Card>;
}
