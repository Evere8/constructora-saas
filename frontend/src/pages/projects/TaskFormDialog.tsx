import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectsApi, type TaskInput } from '@/lib/api/projects';
import { inventoryApi, membersApi, requirementsApi } from '@/lib/api/modules';
import { roleLabel } from '@/auth/permissions';
import type { Level, Task, TaskPriority, TaskStatus, TaskType } from '@/types/api';
import { ApiError } from '@/lib/http';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_TYPE_OPTIONS,
} from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NONE = 'none';

const schema = z.object({
  title: z.string().min(2, 'El titulo es obligatorio'),
  description: z.string().optional(),
  task_type: z.enum(['work', 'transport']),
  status: z.enum(['pending', 'in_progress', 'review', 'completed', 'cancelled']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  level_id: z.string().optional(),
  planned_start_at: z.string().optional(),
  due_at: z.string().optional(),
  location_text: z.string().max(300).optional(),
  assigned_user_id: z.string().optional(),
  inventory_item_id: z.string().optional(),
}).refine(
  (values) => !values.planned_start_at || !values.due_at || values.due_at >= values.planned_start_at,
  { message: 'La fecha límite debe ser posterior al inicio', path: ['due_at'] },
).refine(
  (values) => values.task_type !== 'transport' || Boolean(
    values.inventory_item_id && values.inventory_item_id !== NONE,
  ),
  { message: 'Selecciona la herramienta o máquina que se transportará', path: ['inventory_item_id'] },
);

type FormValues = z.infer<typeof schema>;

export function TaskFormDialog({
  companyId,
  projectId,
  levels,
  task,
  open,
  onOpenChange,
  onCreated,
}: {
  companyId: string;
  projectId: string;
  levels: Level[];
  task?: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (task: Task) => void;
}) {
  const isEdit = Boolean(task);
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      task_type: (task?.task_type ?? 'work') as TaskType,
      status: (task?.status ?? 'pending') as TaskStatus,
      priority: (task?.priority ?? 'normal') as TaskPriority,
      level_id: task?.level_id ?? NONE,
      planned_start_at: task?.planned_start_at?.slice(0, 16) ?? '',
      due_at: task?.due_at?.slice(0, 16) ?? '',
      location_text: task?.location_text ?? '',
      assigned_user_id: task?.assigned_user_id ?? NONE,
      inventory_item_id: NONE,
    },
  });

  const membersQuery = useQuery({
    queryKey: ['members', companyId],
    queryFn: ({ signal }) => membersApi.list(companyId, signal),
    enabled: open,
  });
  const inventoryQuery = useQuery({
    queryKey: ['inventory', companyId],
    queryFn: ({ signal }) => inventoryApi.list(companyId, signal),
    enabled: open && !isEdit,
  });

  const taskType = watch('task_type');
  const status = watch('status');
  const priority = watch('priority');
  const levelId = watch('level_id');
  const assigneeId = watch('assigned_user_id');
  const inventoryItemId = watch('inventory_item_id');
  const selectedInventoryItem = (inventoryQuery.data ?? []).find(
    (item) => item.id === inventoryItemId,
  );
  const requiresRelocation = Boolean(
    selectedInventoryItem
    && selectedInventoryItem.current_project_id !== projectId,
  );

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: TaskInput = {
        title: values.title,
        description: values.description || null,
        task_type: values.task_type,
        status: values.status,
        priority: values.priority,
        level_id: values.level_id && values.level_id !== NONE ? values.level_id : null,
        planned_start_at: values.planned_start_at || null,
        due_at: values.due_at || null,
        location_text: values.location_text || null,
        assigned_user_id:
          values.assigned_user_id && values.assigned_user_id !== NONE
            ? values.assigned_user_id
            : null,
      };
      if (isEdit && task) {
        return projectsApi.updateTask(companyId, projectId, task.id, payload);
      }

      const createdTask = await projectsApi.createTask(companyId, projectId, payload);
      const equipment = (inventoryQuery.data ?? []).find(
        (item) => item.id === values.inventory_item_id,
      );
      if (equipment) {
        await requirementsApi.create(companyId, projectId, createdTask.id, {
          inventory_item_id: equipment.id,
          description: equipment.name,
          required_quantity: 1,
          unit: equipment.unit,
          ...(equipment.current_project_id !== projectId
            ? { relocation_assignee_id: payload.assigned_user_id }
            : {}),
        });
      }
      return createdTask;
    },
    onSuccess: (savedTask) => {
      toast.success(
        isEdit
          ? 'Tarea actualizada'
          : requiresRelocation
            ? 'Tarea creada y reubicación solicitada'
            : 'Tarea creada',
      );
      void queryClient.invalidateQueries({ queryKey: ['tasks', companyId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['task-requirements', companyId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['inventory', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-relocations', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['reports-advanced', companyId] });
      onOpenChange(false);
      if (!isEdit) onCreated?.(savedTask);
    },
    onError: (error) =>
      setFormError(error instanceof ApiError ? error.detail : 'No se pudo guardar la tarea.'),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    if (
      !isEdit
      && requiresRelocation
      && (!values.assigned_user_id || values.assigned_user_id === NONE)
    ) {
      setError('assigned_user_id', {
        message: 'Selecciona al responsable que realizará el traslado',
      });
      return;
    }
    mutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar tarea' : 'Nueva tarea'}</DialogTitle>
        </DialogHeader>
        {!isEdit ? <p className="text-sm text-muted-foreground">Selecciona aquí el equipo principal. Si está fuera de esta obra, se creará su solicitud de reubicación al guardar.</p> : null}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="task-title">Titulo</Label>
            <Input id="task-title" {...register('title')} />
            {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={taskType} onValueChange={(v) => setValue('task_type', v as TaskType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={(v) => setValue('priority', v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!isEdit ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div>
                <Label>Herramienta o máquina</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {taskType === 'transport'
                    ? 'Obligatorio para una tarea de transporte.'
                    : 'Opcional: vincula el equipo principal que utilizará esta tarea.'}
                </p>
              </div>
              <Select
                value={inventoryItemId || NONE}
                onValueChange={(value) => setValue('inventory_item_id', value === NONE ? '' : value)}
                disabled={inventoryQuery.isLoading}
              >
                <SelectTrigger aria-label="Seleccionar herramienta o máquina">
                  <SelectValue placeholder="Seleccionar equipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin equipo por ahora</SelectItem>
                  {(inventoryQuery.data ?? [])
                    .filter((item) => item.item_type === 'machine' || item.item_type === 'tool')
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.code} · {item.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {errors.inventory_item_id ? <p className="text-sm text-destructive">{errors.inventory_item_id.message}</p> : null}
              {selectedInventoryItem ? (
                <div className={requiresRelocation ? 'rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900' : 'rounded-md bg-muted p-2 text-xs text-muted-foreground'}>
                  {requiresRelocation
                    ? 'Este equipo está fuera de la obra. Al guardar se solicitará su reubicación y se asignará al responsable indicado abajo.'
                    : 'Este equipo ya se encuentra en esta obra y quedará vinculado a la tarea.'}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={status} onValueChange={(v) => setValue('status', v as TaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nivel</Label>
              <Select value={levelId} onValueChange={(v) => setValue('level_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin nivel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin nivel</SelectItem>
                  {levels.map((level) => (
                    <SelectItem key={level.id} value={level.id}>
                      {level.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-start">Inicio planificado</Label>
              <Input id="task-start" type="datetime-local" {...register('planned_start_at')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">Fecha límite</Label>
              <Input id="task-due" type="datetime-local" {...register('due_at')} />
              {errors.due_at ? <p className="text-sm text-destructive">{errors.due_at.message}</p> : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-location">Ubicación dentro de la obra</Label>
            <Input id="task-location" placeholder="Ej.: Losa 3, sector norte" {...register('location_text')} />
          </div>
          <div className="space-y-2">
            <Label>{requiresRelocation ? 'Responsable del traslado' : 'Responsable'}</Label>
            <Select value={assigneeId} onValueChange={(v) => setValue('assigned_user_id', v)}>
              <SelectTrigger><SelectValue placeholder="Sin responsable" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin responsable</SelectItem>
                {(membersQuery.data ?? []).filter((member) => member.status === 'active').map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {member.full_name || member.email} · {roleLabel(member.role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {requiresRelocation ? <p className="text-xs text-muted-foreground">Esta persona verá la reubicación pendiente y podrá iniciar y confirmar la llegada del equipo.</p> : null}
            {errors.assigned_user_id ? <p className="text-sm text-destructive">{errors.assigned_user_id.message}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-desc">Descripcion</Label>
            <Textarea id="task-desc" rows={2} {...register('description')} />
          </div>
          {formError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
