import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Pencil, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCan } from '@/auth/useCan';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { inventoryApi, requirementsApi } from '@/lib/api/modules';
import type { InventoryItem, TaskRequirement } from '@/types/api';

const schema = z.object({
  inventory_item_id: z.string(),
  description: z.string().min(2, 'Describe el recurso requerido'),
  required_quantity: z.coerce.number().positive('La cantidad debe ser mayor que cero'),
  unit: z.string().min(1, 'Indica la unidad'),
  availability_status: z.enum(['unchecked', 'available', 'partial', 'missing']),
});

type FormValues = z.infer<typeof schema>;

const STATUS = {
  unchecked: { label: 'Sin verificar', variant: 'muted' as const },
  available: { label: 'Disponible', variant: 'success' as const },
  partial: { label: 'Parcial', variant: 'warning' as const },
  missing: { label: 'Faltante', variant: 'destructive' as const },
};

function RequirementDialog({
  companyId,
  projectId,
  taskId,
  item,
  inventory,
  open,
  onOpenChange,
}: {
  companyId: string;
  projectId: string;
  taskId: string;
  item?: TaskRequirement;
  inventory: InventoryItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      inventory_item_id: item?.inventory_item_id ?? 'manual',
      description: item?.description ?? '',
      required_quantity: Number(item?.required_quantity ?? 1),
      unit: item?.unit ?? 'unidad',
      availability_status: item?.availability_status ?? 'unchecked',
    },
  });
  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const { availability_status, ...resource } = values;
      const shouldSendStatus = Boolean(
        item
        || values.inventory_item_id === 'manual'
        || form.formState.dirtyFields.availability_status,
      );
      const input = {
        ...resource,
        inventory_item_id: values.inventory_item_id === 'manual' ? null : values.inventory_item_id,
        ...(shouldSendStatus ? { availability_status } : {}),
      };
      return item
        ? requirementsApi.update(companyId, projectId, taskId, item.id, input)
        : requirementsApi.create(companyId, projectId, taskId, input);
    },
    onSuccess: () => {
      toast.success(item ? 'Recurso actualizado' : 'Recurso agregado');
      void queryClient.invalidateQueries({ queryKey: ['task-requirements', companyId, projectId, taskId] });
      void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['reports-advanced', companyId] });
      onOpenChange(false);
    },
    onError: () => toast.error('No se pudo guardar el recurso'),
  });

  const selectInventory = (value: string) => {
    form.setValue('inventory_item_id', value);
    const selected = inventory.find((candidate) => candidate.id === value);
    if (selected) {
      form.setValue('description', selected.name);
      form.setValue('unit', selected.unit);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Editar recurso' : 'Agregar recurso requerido'}</DialogTitle>
          <DialogDescription>
            Vincúlalo al inventario para verificar automáticamente si ya está en la obra.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <div className="space-y-1">
            <Label>Inventario</Label>
            <Select value={form.watch('inventory_item_id')} onValueChange={selectInventory}>
              <SelectTrigger aria-label="Seleccionar recurso del inventario"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Recurso sin vincular</SelectItem>
                {inventory.map((inventoryItem) => (
                  <SelectItem key={inventoryItem.id} value={inventoryItem.id}>
                    {inventoryItem.code} · {inventoryItem.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="requirement-description">Descripción</Label>
            <Input id="requirement-description" {...form.register('description')} />
            {form.formState.errors.description ? <p className="text-xs text-destructive">{form.formState.errors.description.message}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="requirement-quantity">Cantidad</Label>
              <Input id="requirement-quantity" type="number" min="0.001" step="0.001" {...form.register('required_quantity')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="requirement-unit">Unidad</Label>
              <Input id="requirement-unit" {...form.register('unit')} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Disponibilidad</Label>
            <Select
              value={form.watch('availability_status')}
              onValueChange={(value) => form.setValue('availability_status', value as FormValues['availability_status'])}
            >
              <SelectTrigger aria-label="Seleccionar disponibilidad"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS).map(([value, statusOption]) => (
                  <SelectItem key={value} value={value}>{statusOption.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando...' : 'Guardar recurso'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaskRequirementsCard({
  companyId,
  projectId,
  taskId,
}: {
  companyId: string;
  projectId: string;
  taskId: string;
}) {
  const canEdit = useCan('requirements.edit');
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRequirement>();
  const query = useQuery({
    queryKey: ['task-requirements', companyId, projectId, taskId],
    queryFn: ({ signal }) => requirementsApi.list(companyId, projectId, taskId, signal),
  });
  const inventoryQuery = useQuery({
    queryKey: ['inventory', companyId],
    queryFn: ({ signal }) => inventoryApi.list(companyId, signal),
    enabled: canEdit,
  });
  const deleteMutation = useMutation({
    mutationFn: (requirementId: string) => requirementsApi.remove(companyId, projectId, taskId, requirementId),
    onSuccess: () => {
      toast.success('Recurso eliminado');
      void queryClient.invalidateQueries({ queryKey: ['task-requirements', companyId, projectId, taskId] });
      void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] });
    },
    onError: () => toast.error('No se pudo eliminar el recurso'),
  });
  const items = query.data ?? [];
  const riskCount = items.filter((item) => item.availability_status !== 'available').length;

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Boxes className="h-4 w-4" /> Recursos requeridos</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Herramientas y materiales necesarios antes de ejecutar.</p>
          </div>
          {canEdit ? <Button size="sm" variant="outline" onClick={openCreate}><Plus className="h-4 w-4" /> Agregar</Button> : null}
        </CardHeader>
        <CardContent>
          {query.isLoading ? <LoadingState label="Verificando recursos..." /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : items.length === 0 ? <EmptyState title="Sin recursos cargados" description="Agrega lo necesario para anticipar faltantes." icon={<Boxes className="h-5 w-5" />} /> : (
            <div className="space-y-2">
              {riskCount > 0 ? <div className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800"><AlertTriangle className="h-4 w-4" /> {riskCount} recurso(s) requieren atención.</div> : null}
              {items.map((item) => {
                const itemStatus = STATUS[item.availability_status];
                return <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.description}</p><p className="text-xs text-muted-foreground">{item.required_quantity} {item.unit}{item.inventory_code ? ` · ${item.inventory_code}` : ''}</p></div><div className="flex items-center gap-1"><Badge variant={itemStatus.variant}>{itemStatus.label}</Badge>{canEdit ? <><Button size="icon" variant="ghost" onClick={() => { setEditing(item); setDialogOpen(true); }}><Pencil className="h-4 w-4" /><span className="sr-only">Editar recurso</span></Button><Button size="icon" variant="ghost" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm('¿Eliminar este recurso requerido?')) deleteMutation.mutate(item.id); }}><Trash2 className="h-4 w-4" /><span className="sr-only">Eliminar recurso</span></Button></> : null}</div></div>;
              })}
            </div>
          )}
        </CardContent>
      </Card>
      {dialogOpen ? <RequirementDialog key={editing?.id ?? 'new'} companyId={companyId} projectId={projectId} taskId={taskId} item={editing} inventory={inventoryQuery.data ?? []} open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
    </>
  );
}
