import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, ClipboardCheck, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCan, useCanAssigned } from '@/auth/useCan';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { checklistApi } from '@/lib/api/checklist';
import {
  CHECKLIST_STATUS,
  CHECKLIST_STATUS_OPTIONS,
  TASK_PRIORITY,
  TASK_STATUS,
  TASK_TYPE,
} from '@/lib/labels';
import { formatDate } from '@/lib/utils';
import { ChecklistEvidenceDialog } from '@/pages/projects/ChecklistEvidenceDialog';
import { ChecklistFormDialog } from '@/pages/projects/ChecklistFormDialog';
import type { ChecklistItem, ChecklistStatus, Task } from '@/types/api';

export function TaskWorkspaceDialog({
  companyId,
  projectId,
  task,
  levelName,
  open,
  onOpenChange,
}: {
  companyId: string;
  projectId: string;
  task: Task;
  levelName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const canEdit = useCan('checklist.edit');
  const canChangeStatus = useCanAssigned('checklist.status');
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistItem | undefined>();
  const [evidenceItem, setEvidenceItem] = useState<ChecklistItem | undefined>();

  const filters = useMemo(() => ({ task_id: task.id, limit: 200 }), [task.id]);
  const query = useQuery({
    queryKey: ['checklist', companyId, projectId, filters],
    queryFn: ({ signal }) => checklistApi.list(companyId, projectId, filters, signal),
    enabled: open,
  });
  const progressQuery = useQuery({
    queryKey: ['checklist-progress', companyId, projectId, { task_id: task.id }],
    queryFn: ({ signal }) => checklistApi.progress(companyId, projectId, { task_id: task.id }, signal),
    enabled: open,
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

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const grouped = useMemo(() => {
    const groups = new Map<string, ChecklistItem[]>();
    for (const item of items) {
      const stage = item.process_stage || 'Sin etapa';
      const stageItems = groups.get(stage);
      if (stageItems) stageItems.push(item);
      else groups.set(stage, [item]);
    }
    return Array.from(groups.entries());
  }, [items]);
  const percent = Math.round(progressQuery.data?.completion_percent ?? 0);
  const taskStatus = TASK_STATUS[task.status];
  const taskPriority = TASK_PRIORITY[task.priority];

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{task.title}</DialogTitle>
            <DialogDescription>
              {TASK_TYPE[task.task_type]} · {levelName}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            <Badge variant={taskStatus?.variant ?? 'muted'}>
              {taskStatus?.label ?? task.status}
            </Badge>
            <Badge variant={taskPriority?.variant ?? 'muted'}>
              {taskPriority?.label ?? task.priority}
            </Badge>
            {task.due_at ? <Badge variant="outline">Vence {formatDate(task.due_at)}</Badge> : null}
          </div>
          {task.description ? <p className="text-sm text-muted-foreground">{task.description}</p> : null}

          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Avance de la tarea</p>
                  <p className="text-xs text-muted-foreground">
                    {progressQuery.data?.completed ?? 0}/{progressQuery.data?.total ?? 0} controles completados
                  </p>
                </div>
                <span className="text-2xl font-semibold">{percent}%</span>
              </div>
              <Progress value={percent} />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Checklist de la tarea</h3>
              <p className="text-sm text-muted-foreground">Controles, fotos y observaciones de ejecución.</p>
            </div>
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
              title="Esta tarea todavía no tiene controles"
              description="Agrega los pasos que deben verificarse antes de completar la tarea."
              icon={<ClipboardCheck className="h-6 w-6" />}
              action={canEdit ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Crear control</Button> : undefined}
            />
          ) : (
            <div className="space-y-5">
              {grouped.map(([stage, stageItems]) => (
                <section key={stage} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold">{stage}</h4>
                    <Badge variant="muted">{stageItems.length}</Badge>
                  </div>
                  <div className="divide-y rounded-lg border">
                    {stageItems.map((item) => {
                      const itemStatus = CHECKLIST_STATUS[item.status];
                      return (
                        <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium">{item.title}</p>
                            {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
                            {item.due_at ? <p className="mt-1 text-xs text-muted-foreground">Vence {formatDate(item.due_at)}</p> : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {canChangeStatus(item.assigned_user_id) ? (
                              <Select
                                value={item.status}
                                disabled={statusMutation.isPending}
                                onValueChange={(value) => statusMutation.mutate({ itemId: item.id, status: value as ChecklistStatus })}
                              >
                                <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {CHECKLIST_STATUS_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant={itemStatus?.variant ?? 'muted'}>{itemStatus?.label ?? item.status}</Badge>
                            )}
                            <Button type="button" variant="outline" size="sm" onClick={() => setEvidenceItem(item)}>
                              <Camera className="h-4 w-4" /> Evidencias
                            </Button>
                            {canEdit ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => { setEditing(item); setFormOpen(true); }}
                              >
                                <Pencil className="h-4 w-4" />
                                <span className="sr-only">Editar control</span>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {formOpen ? (
        <ChecklistFormDialog
          key={editing?.id ?? 'new'}
          companyId={companyId}
          projectId={projectId}
          taskId={task.id}
          item={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      {evidenceItem ? (
        <ChecklistEvidenceDialog
          companyId={companyId}
          projectId={projectId}
          item={evidenceItem}
          open={Boolean(evidenceItem)}
          onOpenChange={(nextOpen) => { if (!nextOpen) setEvidenceItem(undefined); }}
        />
      ) : null}
    </>
  );
}
