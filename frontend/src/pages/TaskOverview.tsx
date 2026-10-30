import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taskLibraryApi } from '@/lib/api/taskLibrary';
import { TASK_STATUS } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/common/states';

export function TaskOverview({ companyId }: { companyId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['task-overview', companyId, offset],
    queryFn: ({ signal }) => taskLibraryApi.overview(companyId, offset, signal),
    refetchInterval: 30_000,
  });

  return <Card>
    <CardHeader><CardTitle className="text-base">Todas las tareas y actividades de las obras</CardTitle><p className="text-sm text-muted-foreground">Vista general exclusiva para propietario e ingeniero.</p></CardHeader>
    <CardContent className="space-y-3">
      {query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Obra</th><th className="p-2">Tarea / actividad</th><th className="p-2">Responsable</th><th className="p-2">Estado</th></tr></thead><tbody>{query.data.items.map((task) => { const state = TASK_STATUS[task.status]; return <tr key={task.id} className="border-b"><td className="p-2">{task.project_name}</td><td className="p-2 font-medium">{task.title}</td><td className="p-2">{task.assigned_user_name ?? 'Sin asignar'}</td><td className="p-2"><Badge variant={state.variant}>{task.status === 'custom' && task.custom_status_label ? task.custom_status_label : state.label}</Badge></td></tr>; })}</tbody></table></div> : <p className="text-sm text-muted-foreground">Todavía no hay tareas registradas.</p>}
      <div className="flex gap-2"><Button variant="outline" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 100))}>Anterior</Button><Button variant="outline" disabled={query.isFetching || offset + 100 >= (query.data?.total ?? 0)} onClick={() => setOffset(offset + 100)}>Siguiente</Button></div>
    </CardContent>
  </Card>;
}
