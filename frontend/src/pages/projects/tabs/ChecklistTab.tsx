import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { checklistApi, type ChecklistFilters } from '@/lib/api/checklist';
import type { ChecklistItem, ChecklistStatus } from '@/types/api';
import { useCan } from '@/auth/useCan';
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
  const canStatus = useCan('checklist.status');
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
    queryFn: ({ signal }) => checklistApi.progress(companyId, projectId, signal),
  });

  const query = useQuery({
    queryKey: ['checklist', companyId, projectId, filters],
    queryFn: ({ signal }) => checklistApi.list(companyId, projectId, filters, signal),
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

  const items = asItems(query.data);
  const grouped = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of items) {
      const stage = item.process_stage || 'Sin etapa';
      const list = map.get(stage) ?? [];
      list.push(item);
      map.set(stage, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const percent = Math.round(progressQuery.data?.percent ?? 0);

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
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
        {canEdit ? (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nuevo control
          </Button>
        ) : null}
      </div>

      {query.isLoading ? (
        <LoadingState label="Cargando checklist..." />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Sin controles"
          description="Agrega puntos de control agrupados por etapa del proceso."
          icon={<ClipboardCheck className="h-6 w-6" />}
          action={canEdit ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Nuevo control</Button> : undefined}
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(([stage, stageItems]) => (
            <div key={stage} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{stage}</h3>
                <Badge variant="muted">{stageItems.length}</Badge>
              </div>
              <Card>
                <CardContent className="divide-y p-0">
                  {stageItems.map((item) => {
                    const status = CHECKLIST_STATUS[item.status];
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.title}</p>
                          {item.due_date ? (
                            <p className="text-xs text-muted-foreground">Vence {formatDate(item.due_date)}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {canStatus ? (
                            <Select
                              value={item.status}
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
                            <Button variant="ghost" size="icon" onClick={() => openEdit(item)}>
                              <Pencil className="h-4 w-4" />
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
