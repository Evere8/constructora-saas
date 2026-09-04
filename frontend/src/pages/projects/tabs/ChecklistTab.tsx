import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { checklistApi, type ChecklistFilters } from '@/lib/api/checklist';
import { projectsApi } from '@/lib/api/projects';
import type { ChecklistItem, ChecklistStatus } from '@/types/api';
import { useCan, useCanAssigned } from '@/auth/useCan';
import { asItems } from '@/lib/collection';
import { CHECKLIST_STATUS, CHECKLIST_STATUS_OPTIONS } from '@/lib/labels';
import { formatDate } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { ChecklistFormDialog } from '@/pages/projects/ChecklistFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = 'all';

export function ChecklistTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('checklist.edit');
  const canChangeStatus = useCanAssigned('checklist.status');
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<ChecklistStatus | typeof ALL>(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistItem | undefined>(undefined);

  const filters = useMemo<ChecklistFilters>(
    () => ({ status: statusFilter === ALL ? undefined : statusFilter, limit: 200 }),
    [statusFilter],
  );

  const progressQuery = useQuery({
    queryKey: ['checklist-progress', companyId, projectId],
    queryFn: ({ signal }) => checklistApi.progress(companyId, projectId, {}, signal),
  });

  const query = useQuery({
    queryKey: ['checklist', companyId, projectId, filters],
    queryFn: ({ signal }) => checklistApi.list(companyId, projectId, filters, signal),
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks', companyId, projectId, { limit: 100 }],
    queryFn: ({ signal }) => projectsApi.listTasks(companyId, projectId, { limit: 100 }, signal),
  });

  const statusMutation = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: ChecklistStatus }) =>
      checklistApi.update(companyId, projectId, itemId, { status }),
    onSuccess: () => {
      toast.success('Estado actualizado');
      void queryClient.invalidateQueries({ queryKey: ['checklist', companyId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['checklist-progress', companyId, projectId] });
    },
    onError: () => toast.error('No se pudo actualizar el estado'),
  });

  const items = useMemo(() => asItems(query.data), [query.data]);
  const grouped = useMemo(() => {
    const taskNames = new Map(asItems(tasksQuery.data).map((task) => [task.id, task.title]));
    const map = new Map<string, { label: string; items: ChecklistItem[] }>();
    for (const item of items) {
      const key = item.task_id || 'legacy';
      const group = map.get(key) ?? {
        label: item.task_id ? taskNames.get(item.task_id) || 'Tarea no disponible' : 'Controles sin tarea',
        items: [],
      };
      group.items.push(item);
      map.set(key, group);
    }
    return Array.from(map.entries());
  }, [items, tasksQuery.data]);

  const percent = Math.round(progressQuery.data?.completion_percent ?? 0);

  const openEdit = (item: ChecklistItem) => {
    setEditing(item);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Avance general</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-end justify-between">
            <span className="text-2xl font-semibold">{percent}%</span>
            <span className="text-sm text-muted-foreground">
              {progressQuery.data?.completed ?? 0}/{progressQuery.data?.total ?? 0} completados
            </span>
          </div>
          <Progress value={percent} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ChecklistStatus | typeof ALL)}>
          <SelectTrigger className="w-full sm:w-[190px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            {CHECKLIST_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Los controles se crean dentro de cada tarea.</p>
      </div>

      {query.isLoading ? (
        <LoadingState label="Cargando checklist..." />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Sin controles"
          description="Abre una tarea y crea allí sus puntos de control."
          icon={<ClipboardCheck className="h-6 w-6" />}
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(([taskId, group]) => (
            <div key={taskId} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{group.label}</h3>
                <Badge variant="muted">{group.items.length}</Badge>
              </div>
              <Card>
                <CardContent className="divide-y p-0">
                  {group.items.map((item) => {
                    const status = CHECKLIST_STATUS[item.status];
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.title}</p>
                          {item.process_stage ? (
                            <p className="text-xs text-muted-foreground">Etapa: {item.process_stage}</p>
                          ) : null}
                          {item.due_at ? (
                            <p className="text-xs text-muted-foreground">Vence {formatDate(item.due_at)}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {canChangeStatus(item.assigned_user_id) ? (
                            <Select
                              value={item.status}
                              disabled={statusMutation.isPending}
                              onValueChange={(v) => statusMutation.mutate({ itemId: item.id, status: v as ChecklistStatus })}
                            >
                              <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {CHECKLIST_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant={status?.variant ?? 'muted'}>{status?.label ?? item.status}</Badge>
                          )}
                          {canEdit ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(item)}
                            >
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">Editar {item.title}</span>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}

      {canEdit ? (
        <ChecklistFormDialog
          key={editing?.id ?? 'new'}
          companyId={companyId}
          projectId={projectId}
          item={editing}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </div>
  );
}
