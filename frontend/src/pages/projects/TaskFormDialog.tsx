import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectsApi, type TaskInput } from '@/lib/api/projects';
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
  due_date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function TaskFormDialog({
  companyId,
  projectId,
  levels,
  task,
  open,
  onOpenChange,
}: {
  companyId: string;
  projectId: string;
  levels: Level[];
  task?: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = Boolean(task);
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
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
      due_date: task?.due_date?.slice(0, 10) ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: TaskInput = {
        title: values.title,
        description: values.description || null,
        task_type: values.task_type,
        status: values.status,
        priority: values.priority,
        level_id: values.level_id && values.level_id !== NONE ? values.level_id : null,
        due_date: values.due_date || null,
      };
      return isEdit && task
        ? projectsApi.updateTask(companyId, projectId, task.id, payload)
        : projectsApi.createTask(companyId, projectId, payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Tarea actualizada' : 'Tarea creada');
      void queryClient.invalidateQueries({ queryKey: ['tasks', companyId, projectId] });
      onOpenChange(false);
    },
    onError: (error) =>
      setFormError(error instanceof ApiError ? error.detail : 'No se pudo guardar la tarea.'),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    mutation.mutate(values);
  });

  const taskType = watch('task_type');
  const status = watch('status');
  const priority = watch('priority');
  const levelId = watch('level_id');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar tarea' : 'Nueva tarea'}</DialogTitle>
        </DialogHeader>
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
          <div className="space-y-2">
            <Label htmlFor="task-due">Fecha limite</Label>
            <Input id="task-due" type="date" {...register('due_date')} />
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
