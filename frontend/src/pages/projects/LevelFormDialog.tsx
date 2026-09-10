import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectsApi } from '@/lib/api/projects';
import type { Level, ProjectSector } from '@/types/api';
import { ApiError } from '@/lib/http';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const schema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  sector_id: z.string().min(1, 'Selecciona un sector'),
  work_status: z.enum(['pending', 'in_progress', 'concreted']),
  concreted_at: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function LevelFormDialog({
  companyId,
  projectId,
  level,
  sectors,
  defaultSectorId,
  open,
  onOpenChange,
}: {
  companyId: string;
  projectId: string;
  level?: Level;
  sectors: ProjectSector[];
  defaultSectorId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = Boolean(level);
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: level?.name ?? '',
      sector_id:
        level?.sector_id
        ?? sectors.find((sector) => sector.name === level?.building_name)?.id
        ?? defaultSectorId
        ?? sectors[0]?.id
        ?? '',
      work_status: level?.work_status ?? 'pending',
      concreted_at: level?.concreted_at ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name,
        sector_id: values.sector_id,
        work_status: values.work_status,
        concreted_at: values.work_status === 'concreted' ? values.concreted_at || null : null,
      };
      return isEdit && level
        ? projectsApi.updateLevel(companyId, projectId, level.id, payload)
        : projectsApi.createLevel(companyId, projectId, payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Nivel actualizado' : 'Nivel creado');
      void queryClient.invalidateQueries({ queryKey: ['levels', companyId, projectId] });
      onOpenChange(false);
    },
    onError: (error) =>
      setFormError(error instanceof ApiError ? error.detail : 'No se pudo guardar el nivel.'),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    mutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar nivel' : 'Nuevo nivel'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="level-name">Nivel o losa</Label>
            <Input id="level-name" placeholder="Nivel 1, Losa 3, Planta baja..." {...register('name')} />
            {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="level-sector">Sector</Label>
            <select
              id="level-sector"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...register('sector_id')}
            >
              <option value="">Selecciona un sector</option>
              {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
            </select>
            {errors.sector_id ? <p className="text-sm text-destructive">{errors.sector_id.message}</p> : null}
            <p className="text-xs text-muted-foreground">Puedes repetir el mismo nivel o losa en sectores distintos.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="level-work-status">Estado en obra</Label>
              <select
                id="level-work-status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register('work_status')}
              >
                <option value="pending">Pendiente</option>
                <option value="in_progress">En ejecución</option>
                <option value="concreted">Hormigonado</option>
              </select>
            </div>
            {watch('work_status') === 'concreted' ? (
              <div className="space-y-2">
                <Label htmlFor="level-concreted-at">Fecha de hormigonado</Label>
                <Input id="level-concreted-at" type="date" {...register('concreted_at')} />
              </div>
            ) : null}
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
