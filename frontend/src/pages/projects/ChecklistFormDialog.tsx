import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { checklistApi, type ChecklistInput } from '@/lib/api/checklist';
import { membersApi } from '@/lib/api/modules';
import { roleLabel } from '@/auth/permissions';
import type { ChecklistItem, ChecklistStatus } from '@/types/api';
import { ApiError } from '@/lib/http';
import { CHECKLIST_STATUS_OPTIONS } from '@/lib/labels';
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
  process_stage: z.string().min(1, 'La etapa es obligatoria'),
  status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'not_applicable']),
  description: z.string().optional(),
  due_at: z.string().optional(),
  assigned_user_id: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ChecklistFormDialog({
  companyId,
  projectId,
  taskId,
  item,
  open,
  onOpenChange,
}: {
  companyId: string;
  projectId: string;
  taskId?: string;
  item?: ChecklistItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = Boolean(item);
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
      title: item?.title ?? '',
      process_stage: item?.process_stage ?? '',
      status: (item?.status ?? 'pending') as ChecklistStatus,
      description: item?.description ?? '',
      due_at: item?.due_at?.slice(0, 10) ?? '',
      assigned_user_id: item?.assigned_user_id ?? NONE,
    },
  });

  const membersQuery = useQuery({
    queryKey: ['members', companyId],
    queryFn: ({ signal }) => membersApi.list(companyId, signal),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: ChecklistInput = {
        task_id: taskId ?? item?.task_id ?? null,
        title: values.title,
        process_stage: values.process_stage,
        status: values.status,
        description: values.description || null,
        due_at: values.due_at || null,
        assigned_user_id:
          values.assigned_user_id && values.assigned_user_id !== NONE
            ? values.assigned_user_id
            : null,
      };
      return isEdit && item
        ? checklistApi.update(companyId, projectId, item.id, payload)
        : checklistApi.create(companyId, projectId, payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Control actualizado' : 'Control creado');
      void queryClient.invalidateQueries({ queryKey: ['checklist', companyId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['checklist-progress', companyId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['reports-advanced', companyId] });
      onOpenChange(false);
    },
    onError: (error) =>
      setFormError(error instanceof ApiError ? error.detail : 'No se pudo guardar el control.'),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    mutation.mutate(values);
  });

  const status = watch('status');
  const assigneeId = watch('assigned_user_id');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar control' : 'Nuevo control'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="cl-title">Titulo</Label>
            <Input id="cl-title" {...register('title')} />
            {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cl-stage">Etapa del proceso</Label>
              <Input id="cl-stage" placeholder="Cimentacion, Estructura..." {...register('process_stage')} />
              {errors.process_stage ? (
                <p className="text-sm text-destructive">{errors.process_stage.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={status} onValueChange={(v) => setValue('status', v as ChecklistStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cl-due">Vencimiento</Label>
            <Input id="cl-due" type="date" {...register('due_at')} />
          </div>
          <div className="space-y-2">
            <Label>Responsable</Label>
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="cl-desc">Descripcion</Label>
            <Textarea id="cl-desc" rows={2} {...register('description')} />
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
