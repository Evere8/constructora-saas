import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { projectsApi, type TaskInput } from '@/lib/api/projects';
import { inventoryApi, membersApi } from '@/lib/api/modules';
import { taskLibraryApi } from '@/lib/api/taskLibrary';
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
  title: z.string().min(2, 'El título es obligatorio'),
  description: z.string().optional(),
  task_type: z.enum(['work', 'transport']),
  status: z.enum(['pending', 'in_progress', 'review', 'completed', 'cancelled']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  level_id: z.string().optional(),
  planned_start_at: z.string().optional(),
  due_at: z.string().optional(),
  location_text: z.string().max(300).optional(),
  assigned_user_id: z.string().optional(),
  template_id: z.string().optional(),
  inventory_item_ids: z.array(z.string()).default([]),
}).refine(
  (values) => !values.planned_start_at || !values.due_at || values.due_at >= values.planned_start_at,
  { message: 'La fecha límite debe ser posterior al inicio', path: ['due_at'] },
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
      template_id: task?.template_id ?? NONE,
      inventory_item_ids: [],
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
  const templatesQuery = useQuery({
    queryKey: ['task-templates', companyId],
    queryFn: ({ signal }) => taskLibraryApi.listTemplates(companyId, true, signal),
    enabled: open && !isEdit,
  });

  const taskType = watch('task_type');
  const status = watch('status');
  const priority = watch('priority');
  const levelId = watch('level_id');
  const assigneeId = watch('assigned_user_id');
  const templateId = watch('template_id');
  const inventoryItemIds = watch('inventory_item_ids');
  const selectedTemplate = (templatesQuery.data ?? []).find((item) => item.id === templateId);
  const inventory = inventoryQuery.data ?? [];
  const templateInventoryIds = useMemo(
    () => (selectedTemplate?.resources ?? [])
      .map((resource) => resource.inventory_item_id)
      .filter((id): id is string => Boolean(id)),
    [selectedTemplate],
  );
  const allInventoryIds = useMemo(
    () => Array.from(new Set([...templateInventoryIds, ...inventoryItemIds])),
    [inventoryItemIds, templateInventoryIds],
  );
  const selectedEquipment = useMemo(
    () => allInventoryIds
      .map((id) => inventory.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [allInventoryIds, inventory],
  );
  const requiresRelocation = selectedEquipment.some(
    (item) => item.current_project_id !== projectId,
  );

  const applyTemplate = (value: string) => {
    const nextId = value === NONE ? NONE : value;
    setValue('template_id', nextId, { shouldValidate: true });
    const template = (templatesQuery.data ?? []).find((item) => item.id === nextId);
    if (!template) return;
    setValue('title', template.title, { shouldValidate: true });
    setValue('description', template.description ?? '');
    setValue('task_type', template.task_type, { shouldValidate: true });
    setValue('priority', template.priority);
    setValue('location_text', template.default_location_text ?? '');
  };

  const addEquipment = (value: string) => {
    if (value === NONE || allInventoryIds.includes(value)) return;
    setValue('inventory_item_ids', [...inventoryItemIds, value], { shouldValidate: true });
  };

  const removeEquipment = (id: string) => {
    setValue(
      'inventory_item_ids',
      inventoryItemIds.filter((itemId) => itemId !== id),
      { shouldValidate: true },
    );
  };

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
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
        ...(isEdit ? {} : {
          template_id: values.template_id && values.template_id !== NONE ? values.template_id : null,
          inventory_item_ids: values.inventory_item_ids,
        }),
      };
      return isEdit && task
        ? projectsApi.updateTask(companyId, projectId, task.id, payload)
        : projectsApi.createTask(companyId, projectId, payload);
    },
    onSuccess: (savedTask) => {
      toast.success(
        isEdit
          ? 'Tarea actualizada'
          : requiresRelocation
            ? 'Tarea creada y reubicación solicitada'
            : 'Tarea creada con sus recursos',
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
    if (!isEdit && values.task_type === 'transport' && allInventoryIds.length === 0) {
      setError('inventory_item_ids', {
        message: 'Selecciona al menos una herramienta o máquina para transportar',
      });
      return;
    }
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
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar tarea' : 'Nueva tarea'}</DialogTitle>
        </DialogHeader>
        {!isEdit ? (
          <p className="text-sm text-muted-foreground">
            Usa una tarea predeterminada para cargar de una vez su checklist y todas sus herramientas.
          </p>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {!isEdit ? (
            <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
              <div>
                <Label>Tarea predeterminada</Label>
                <p className="mt-1 text-xs text-muted-foreground">Opcional: carga los recursos y controles ya definidos.</p>
              </div>
              <Select value={templateId || NONE} onValueChange={applyTemplate}>
                <SelectTrigger aria-label="Seleccionar tarea predeterminada"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Crear tarea manual</SelectItem>
                  {(templatesQuery.data ?? []).map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.title} · {template.resources.length} recurso(s)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate ? (
                <p className="text-xs text-primary">
                  Se cargarán {selectedTemplate.resources.length} recurso(s) y {selectedTemplate.checklist_items.length} control(es).
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="task-title">Título</Label>
            <Input id="task-title" {...register('title')} />
            {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={taskType} onValueChange={(value) => setValue('task_type', value as TaskType, { shouldValidate: true })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={(value) => setValue('priority', value as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isEdit ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <Label>Herramientas y máquinas</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {taskType === 'transport'
                    ? 'Selecciona todos los equipos que se transportarán.'
                    : 'Puedes agregar tantas herramientas o máquinas como necesite la tarea.'}
                </p>
              </div>
              <Select value={NONE} onValueChange={addEquipment} disabled={inventoryQuery.isLoading}>
                <SelectTrigger aria-label="Agregar herramienta o máquina"><SelectValue placeholder="Agregar equipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Seleccionar equipo</SelectItem>
                  {inventory
                    .filter((item) => (item.item_type === 'machine' || item.item_type === 'tool') && !allInventoryIds.includes(item.id))
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.code} · {item.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selectedEquipment.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedEquipment.map((item) => {
                    const fromTemplate = templateInventoryIds.includes(item.id);
                    return (
                      <span key={item.id} className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs">
                        {item.code} · {item.name}
                        {fromTemplate ? <span className="text-muted-foreground">(predeterminada)</span> : null}
                        {!fromTemplate ? (
                          <button type="button" aria-label={`Quitar ${item.name}`} onClick={() => removeEquipment(item.id)}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              ) : null}
              {errors.inventory_item_ids ? <p className="text-sm text-destructive">{errors.inventory_item_ids.message}</p> : null}
              {requiresRelocation ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Uno o más equipos están fuera de esta obra. Al guardar se crea una reubicación por cada equipo y no se marcarán en el plano hasta confirmar su llegada.
                </div>
              ) : null}
              {selectedTemplate?.resources.filter((resource) => !resource.inventory_item_id).length ? (
                <p className="text-xs text-muted-foreground">
                  La plantilla también incluye {selectedTemplate.resources.filter((resource) => !resource.inventory_item_id).length} recurso(s) manual(es).
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={status} onValueChange={(value) => setValue('status', value as TaskStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nivel</Label>
              <Select value={levelId} onValueChange={(value) => setValue('level_id', value)}>
                <SelectTrigger><SelectValue placeholder="Sin nivel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin nivel</SelectItem>
                  {levels.map((level) => (
                    <SelectItem key={level.id} value={level.id}>
                      {(level.building_name || 'Obra general')} · {level.name}
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
            <Select value={assigneeId} onValueChange={(value) => setValue('assigned_user_id', value, { shouldValidate: true })}>
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
            {requiresRelocation ? <p className="text-xs text-muted-foreground">Esta persona podrá iniciar el traslado y confirmar la llegada de cada equipo.</p> : null}
            {errors.assigned_user_id ? <p className="text-sm text-destructive">{errors.assigned_user_id.message}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-desc">Descripción</Label>
            <Textarea id="task-desc" rows={2} {...register('description')} />
          </div>
          {formError ? <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</div> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
