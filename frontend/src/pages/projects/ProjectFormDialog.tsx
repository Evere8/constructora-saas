import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectsApi, type ProjectInput } from '@/lib/api/projects';
import type { Project, ProjectStatus } from '@/types/api';
import { ApiError } from '@/lib/http';
import { PROJECT_STATUS_OPTIONS } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

const schema = z.object({
  name: z.string().min(2, 'El nombre es obligatorio'),
  code: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'inactive', 'completed', 'archived']),
  address: z.string().optional(),
  start_date: z.string().optional(),
  planned_end_date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ProjectFormDialog({
  companyId,
  project,
  open,
  onOpenChange,
}: {
  companyId: string;
  project?: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = Boolean(project);
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project?.name ?? '',
      code: project?.code ?? '',
      description: project?.description ?? '',
      status: (project?.status ?? 'active') as ProjectStatus,
      address: project?.address ?? '',
      start_date: project?.start_date?.slice(0, 10) ?? '',
      planned_end_date: project?.planned_end_date?.slice(0, 10) ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: ProjectInput = {
        name: values.name,
        code: values.code || null,
        description: values.description || null,
        status: values.status,
        address: values.address || null,
        start_date: values.start_date || null,
        planned_end_date: values.planned_end_date || null,
      };
      return isEdit && project
        ? projectsApi.update(companyId, project.id, payload)
        : projectsApi.create(companyId, payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Obra actualizada' : 'Obra creada');
      void queryClient.invalidateQueries({ queryKey: ['projects', companyId] });
      if (project) void queryClient.invalidateQueries({ queryKey: ['project', companyId, project.id] });
      onOpenChange(false);
      reset();
    },
    onError: (error) => {
      setFormError(error instanceof ApiError ? error.detail : 'No se pudo guardar la obra.');
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    mutation.mutate(values);
  });

  const status = watch('status');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar obra' : 'Nueva obra'}</DialogTitle>
          <DialogDescription>
            Completa la informacion de la obra. Los datos se guardan en la API de Obrixapy.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" {...register('name')} />
            {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="code">Codigo</Label>
              <Input id="code" placeholder="OBRA-001" {...register('code')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Estado</Label>
              <Select value={status} onValueChange={(v) => setValue('status', v as ProjectStatus)}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Direccion</Label>
            <Input id="address" {...register('address')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start_date">Fecha de inicio</Label>
              <Input id="start_date" type="date" {...register('start_date')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="planned_end_date">Fecha prevista de fin</Label>
              <Input id="planned_end_date" type="date" {...register('planned_end_date')} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descripcion</Label>
            <Textarea id="description" rows={3} {...register('description')} />
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
              {isEdit ? 'Guardar cambios' : 'Crear obra'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
