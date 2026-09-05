import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Truck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useCan, useCanAssigned } from '@/auth/useCan';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { inventoryApi } from '@/lib/api/modules';
import type { InventoryRelocationRequest } from '@/types/api';

const STATUS = {
  pending: { label: 'Pendiente de reubicación', variant: 'warning' as const },
  in_transit: { label: 'En traslado', variant: 'info' as const },
  completed: { label: 'Ubicada en obra', variant: 'success' as const },
  cancelled: { label: 'Cancelada', variant: 'muted' as const },
};

function requestDescription(request: InventoryRelocationRequest): string {
  const origin = request.from_project_name || 'Depósito';
  const destination = request.to_project_name || 'Obra destino';
  return `${origin} → ${destination}`;
}

export function RelocationRequestsCard({
  companyId,
  projectId,
  taskId,
  title = 'Reubicaciones pendientes',
}: {
  companyId: string;
  projectId?: string;
  taskId?: string;
  title?: string;
}) {
  const canActOnAssigned = useCanAssigned('inventory.relocate');
  const canCancel = useCan('inventory.move');
  const queryClient = useQueryClient();
  const filters = useMemo(
    () => ({ project_id: projectId, task_id: taskId, active_only: true }),
    [projectId, taskId],
  );
  const query = useQuery({
    queryKey: ['inventory-relocations', companyId, filters],
    queryFn: ({ signal }) => inventoryApi.listRelocations(companyId, filters, signal),
    enabled: Boolean(companyId),
    refetchInterval: 15_000,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory-relocations', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['inventory', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['task-requirements', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['reports-advanced', companyId] });
  };
  const actionMutation = useMutation({
    mutationFn: ({ request, action }: { request: InventoryRelocationRequest; action: 'start' | 'complete' | 'cancel' }) => {
      if (action === 'start') return inventoryApi.startRelocation(companyId, request.id);
      if (action === 'complete') return inventoryApi.completeRelocation(companyId, request.id);
      return inventoryApi.cancelRelocation(companyId, request.id);
    },
    onSuccess: (_, variables) => {
      const label = variables.action === 'start'
        ? 'Traslado iniciado'
        : variables.action === 'complete'
          ? 'Llegada confirmada y ubicación actualizada'
          : 'Reubicación cancelada';
      toast.success(label);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message || 'No se pudo actualizar la reubicación'),
  });

  const requests = query.data ?? [];
  if (!query.isLoading && !query.isError && requests.length === 0) return null;

  return (
    <Card className="border-amber-200">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4 text-amber-600" /> {title}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">El equipo conserva su ubicación anterior hasta confirmar su llegada.</p>
        </div>
        <Badge variant="warning">{requests.length}</Badge>
      </CardHeader>
      <CardContent>
        {query.isLoading ? <p className="text-sm text-muted-foreground">Comprobando reubicaciones...</p> : query.isError ? <p className="text-sm text-destructive">No se pudieron cargar las reubicaciones.</p> : <div className="divide-y rounded-md border">{requests.map((request) => {
          const itemStatus = STATUS[request.status];
          const canAct = canActOnAssigned(request.assigned_user_id);
          return <div key={request.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{request.inventory_name || 'Equipo'}</p><Badge variant={itemStatus.variant}>{itemStatus.label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{request.inventory_code ? `${request.inventory_code} · ` : ''}{requestDescription(request)}</p><p className="mt-1 text-xs text-muted-foreground">Tarea: {request.task_title || '—'} · Responsable: {request.assigned_user_name || 'Sin asignar'}</p></div><div className="flex flex-wrap gap-2">{request.status === 'pending' && canAct ? <Button size="sm" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ request, action: 'start' })}><Truck className="h-4 w-4" /> Iniciar traslado</Button> : null}{request.status === 'in_transit' && canAct ? <Button size="sm" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ request, action: 'complete' })}><CheckCircle2 className="h-4 w-4" /> Confirmar llegada</Button> : null}{request.status === 'pending' && canCancel ? <Button size="sm" variant="outline" disabled={actionMutation.isPending} onClick={() => { if (window.confirm('¿Cancelar esta reubicación? El equipo volverá a quedar disponible en su ubicación actual.')) actionMutation.mutate({ request, action: 'cancel' }); }}><XCircle className="h-4 w-4" /> Cancelar</Button> : null}{!canAct ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> Esperando al responsable</span> : null}</div></div>;
        })}</div>}
      </CardContent>
    </Card>
  );
}
