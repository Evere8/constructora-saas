import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { PackagePlus, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { inventoryApi } from '@/lib/api/modules';
import { projectsApi } from '@/lib/api/projects';
import { asItems } from '@/lib/collection';
import type { InventoryItem } from '@/types/api';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const schema = z.object({
  code: z.string().min(1, 'Ingrese un código').max(80),
  name: z.string().min(2, 'Ingrese un nombre').max(180),
  item_type: z.enum(['machine', 'tool', 'material']),
  unit: z.string().min(1).max(30),
  serial_number: z.string().max(120).optional(),
  quantity: z.coerce.number().positive(),
});
type FormValues = z.infer<typeof schema>;

const TYPE_LABELS = { machine: 'Máquina', tool: 'Herramienta', material: 'Material' };
const STATUS_LABELS = { available: 'Disponible', assigned: 'En obra', maintenance: 'Mantenimiento', retired: 'Retirado' };

export function InventoryPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const canEdit = useCan('inventory.edit');
  const canMove = useCan('inventory.move');
  const queryClient = useQueryClient();
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { item_type: 'tool', unit: 'unidad', quantity: 1 } });
  const query = useQuery({ queryKey: ['inventory', companyId], queryFn: ({ signal }) => inventoryApi.list(companyId, signal), enabled: Boolean(companyId) });
  const projectsQuery = useQuery({ queryKey: ['projects', companyId, { limit: 100 }], queryFn: ({ signal }) => projectsApi.list(companyId, { limit: 100 }, signal), enabled: Boolean(companyId) });
  const createMutation = useMutation({
    mutationFn: (values: FormValues) => inventoryApi.create(companyId, values),
    onSuccess: () => { toast.success('Elemento registrado'); form.reset({ item_type: 'tool', unit: 'unidad', quantity: 1, code: '', name: '', serial_number: '' }); void queryClient.invalidateQueries({ queryKey: ['inventory', companyId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const moveMutation = useMutation({
    mutationFn: ({ item, destination }: { item: InventoryItem; destination: string }) => inventoryApi.move(companyId, { item_id: item.id, to_project_id: destination === 'warehouse' ? null : destination, quantity: Number(item.quantity) }),
    onSuccess: () => { toast.success('Movimiento registrado'); void queryClient.invalidateQueries({ queryKey: ['inventory', companyId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const projects = asItems(projectsQuery.data);

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Herramientas e inventario</h1><p className="text-sm text-muted-foreground">Controla máquinas, herramientas y materiales, y registra a qué obra se entregan.</p></div>
    {canEdit ? <Card><CardContent className="p-4"><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-8 lg:items-end" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
      <div className="space-y-1"><Label htmlFor="inventory-code">Código</Label><Input id="inventory-code" {...form.register('code')} />{form.formState.errors.code ? <p className="text-xs text-destructive">{form.formState.errors.code.message}</p> : null}</div>
      <div className="space-y-1 lg:col-span-2"><Label htmlFor="inventory-name">Nombre</Label><Input id="inventory-name" {...form.register('name')} /></div>
      <div className="space-y-1"><Label>Tipo</Label><Select value={form.watch('item_type')} onValueChange={(value) => form.setValue('item_type', value as FormValues['item_type'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tool">Herramienta</SelectItem><SelectItem value="machine">Máquina</SelectItem><SelectItem value="material">Material</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="inventory-unit">Unidad</Label><Input id="inventory-unit" {...form.register('unit')} /></div>
      <div className="space-y-1"><Label htmlFor="inventory-serial">Serie</Label><Input id="inventory-serial" {...form.register('serial_number')} /></div>
      <div className="space-y-1"><Label htmlFor="inventory-quantity">Cantidad</Label><Input id="inventory-quantity" type="number" min="0.001" step="0.001" {...form.register('quantity')} /></div>
      <Button type="submit" disabled={createMutation.isPending}><PackagePlus className="h-4 w-4" /> Agregar</Button>
    </form></CardContent></Card> : null}
    {query.isLoading ? <LoadingState label="Cargando inventario..." /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data?.length ? <div className="space-y-3">{query.data.map((item) => <Card key={item.id}><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2"><p className="font-medium">{item.name}</p><Badge variant="muted">{TYPE_LABELS[item.item_type]}</Badge><Badge variant={item.status === 'maintenance' ? 'warning' : 'outline'}>{STATUS_LABELS[item.status]}</Badge></div><p className="text-xs text-muted-foreground">{item.code} · {item.quantity} {item.unit}{item.serial_number ? ` · Serie ${item.serial_number}` : ''}</p></div>{canMove && item.item_type !== 'material' ? <div className="flex gap-2"><Select value={destinations[item.id] ?? item.current_project_id ?? 'warehouse'} onValueChange={(value) => setDestinations((current) => ({ ...current, [item.id]: value }))}><SelectTrigger className="w-[200px]"><SelectValue placeholder="Destino" /></SelectTrigger><SelectContent><SelectItem value="warehouse">Depósito</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={() => moveMutation.mutate({ item, destination: destinations[item.id] ?? item.current_project_id ?? 'warehouse' })}>Registrar movimiento</Button></div> : null}</CardContent></Card>)}</div> : <EmptyState title="Sin herramientas" description="Registra la primera herramienta, máquina o material." icon={<Wrench className="h-6 w-6" />} />}
  </div>;
}
