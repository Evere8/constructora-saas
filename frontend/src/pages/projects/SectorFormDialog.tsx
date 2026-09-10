import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectsApi } from '@/lib/api/projects';
import type { ProjectSector } from '@/types/api';
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
  name: z.string().trim().min(1, 'El nombre del sector es obligatorio').max(120),
});

type FormValues = z.infer<typeof schema>;

export function SectorFormDialog({
  companyId,
  projectId,
  sector,
  open,
  onOpenChange,
}: {
  companyId: string;
  projectId: string;
  sector?: ProjectSector;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = Boolean(sector);
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: sector?.name ?? '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      isEdit && sector
        ? projectsApi.updateSector(companyId, projectId, sector.id, { name: values.name.trim() })
        : projectsApi.createSector(companyId, projectId, { name: values.name.trim() }),
    onSuccess: () => {
      toast.success(isEdit ? 'Sector actualizado' : 'Sector creado');
      void queryClient.invalidateQueries({ queryKey: ['project-sectors', companyId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['levels', companyId, projectId] });
      onOpenChange(false);
    },
    onError: (error) =>
      setFormError(error instanceof ApiError ? error.detail : 'No se pudo guardar el sector.'),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    mutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar sector' : 'Nuevo sector'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" noValidate onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="sector-name">Nombre del sector</Label>
            <Input id="sector-name" autoFocus placeholder="Torre Habitacional 3, Bloque A…" {...register('name')} />
            {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
            <p className="text-xs text-muted-foreground">Cada sector tendrá su propia columna y puede repetir nombres de nivel.</p>
          </div>
          {formError ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
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
