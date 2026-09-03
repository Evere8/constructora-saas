import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { projectsApi, type TaskFilters } from '@/lib/api/projects';
import type { Task, TaskStatus, TaskType } from '@/types/api';
import { useCan } from '@/auth/useCan';
import { asItems, asTotal } from '@/lib/collection';
import {
  TASK_PRIORITY,
  TASK_STATUS,
  TASK_STATUS_OPTIONS,
  TASK_TYPE,
  TASK_TYPE_OPTIONS,
} from '@/lib/labels';
import { formatDate } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { TaskFormDialog } from '@/pages/projects/TaskFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 10;
const ALL = 'all';

export function TareasTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('tasks.edit');
  const canStatus = useCan('tasks.status');
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<TaskStatus | typeof ALL>(ALL);
  const [typeFilter, setTypeFilter] = useState<TaskType | typeof ALL>(ALL);
  const [levelFilter, setLevelFilter] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | undefined>(undefined);

  const levelsQuery = useQuery({
    queryKey: ['levels', companyId, projectId],
    queryFn: ({ signal }) => projectsApi.listLevels(companyId, projectId, signal),
  });
  const levels = asItems(levelsQuery.data);

  const filters = useMemo<TaskFilters>(
    () => ({
      status: statusFilter === ALL ? undefined : statusFilter,
      task_type: typeFilter === ALL ? undefined : typeFilter,
      level_id: levelFilter === ALL ? undefined : levelFilter,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [statusFilter, typeFilter, levelFilter, page],
  );

  const query = useQuery({
    queryKey: ['tasks', companyId, projectId, filters],
    queryFn: ({ signal }) => projectsApi.listTasks(companyId, projectId, filters, signal),
    placeholderData: keepPreviousData,
  });

  const statusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      projectsApi.updateTask(companyId, projectId, taskId, { status }),
    onSuccess: () => {
      toast.success('Estado actualizado');
      void queryClient.invalidateQueries({ queryKey: ['tasks', companyId, projectId] });
    },
    onError: () => toast.error('No se pudo actualizar el estado'),
  });

  const tasks = asItems(query.data);
  const total = asTotal(query.data);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const levelName = (id?: string | null) => levels.find((l) => l.id === id)?.name ?? '\u2014';

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (task: Task) => {
    setEditing(task);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as TaskStatus | typeof ALL); setPage(0); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              {TASK_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as TaskType | typeof ALL); setPage(0); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todo tipo</SelectItem>
              {TASK_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={levelFilter} onValueChange={(v) => { setLevelFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Nivel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los niveles</SelectItem>
              {levels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nueva tarea
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          {query.isLoading ? (
            <LoadingState label="Cargando tareas..." />
          ) : query.isError ? (
            <div className="p-6"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
          ) : tasks.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Sin tareas"
                description="No hay tareas con los filtros seleccionados."
                icon={<ListChecks className="h-6 w-6" />}
                action={canEdit ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Nueva tarea</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarea</TableHead>
                  <TableHead className="hidden sm:table-cell">Tipo</TableHead>
                  <TableHead className="hidden md:table-cell">Nivel</TableHead>
                  <TableHead className="hidden md:table-cell">Prioridad</TableHead>
                  <TableHead>Estado</TableHead>
                  {canEdit ? <TableHead className="text-right">Acciones</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const priority = TASK_PRIORITY[task.priority];
                  const status = TASK_STATUS[task.status];
                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <p className="font-medium">{task.title}</p>
                        {task.due_date ? (
                          <p className="text-xs text-muted-foreground">Vence {formatDate(task.due_date)}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">{TASK_TYPE[task.task_type]}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{levelName(task.level_id)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant={priority?.variant ?? 'muted'}>{priority?.label ?? task.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        {canStatus ? (
                          <Select
                            value={task.status}
                            onValueChange={(v) => statusMutation.mutate({ taskId: task.id, status: v as TaskStatus })}
                          >
                            <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TASK_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={status?.variant ?? 'muted'}>{status?.label ?? task.status}</Badge>
                        )}
                      </TableCell>
                      {canEdit ? (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(task)}>
                            <Pencil className="h-4 w-4" /> Editar
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Pagina {page + 1} de {totalPages} - {total} tareas</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <TaskFormDialog
          key={editing?.id ?? 'new'}
          companyId={companyId}
          projectId={projectId}
          levels={levels}
          task={editing}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </div>
  );
}
