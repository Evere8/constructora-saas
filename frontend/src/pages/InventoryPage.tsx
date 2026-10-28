import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { History, PackagePlus, Send, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { inventoryApi } from '@/lib/api/modules';
import { dailyOperationsApi, operationalToday } from '@/lib/api/dailyOperations';
import { projectsApi } from '@/lib/api/projects';
import { asItems } from '@/lib/collection';
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
const STATUS_LABELS = {
  available: 'Disponible',
  assigned: 'En obra',
  relocation_pending: 'Reubicación pendiente',
  in_transit: 'En traslado',
  maintenance: 'Mantenimiento',
  retired: 'Retirado',
};

export function InventoryPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const canEdit = useCan('inventory.edit');
  const canMove = useCan('inventory.move');
  const queryClient = useQueryClient();
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestProject, setRequestProject] = useState('warehouse');
  const [requestQuantity, setRequestQuantity] = useState(1);
  const [requestNote, setRequestNote] = useState('');
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { item_type: 'tool', unit: 'unidad', quantity: 1 } });
  const query = useQuery({ queryKey: ['inventory', companyId], queryFn: ({ signal }) => inventoryApi.list(companyId, signal), enabled: Boolean(companyId) });
  const projectsQuery = useQuery({ queryKey: ['projects', companyId, { limit: 100 }], queryFn: ({ signal }) => projectsApi.list(companyId, { limit: 100 }, signal), enabled: Boolean(companyId) });
  const createMutation = useMutation({
    mutationFn: (values: FormValues) => inventoryApi.create(companyId, values),
    onSuccess: () => { toast.success('Elemento registrado'); form.reset({ item_type: 'tool', unit: 'unidad', quantity: 1, code: '', name: '', serial_number: '' }); void queryClient.invalidateQueries({ queryKey: ['inventory', companyId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const daysQuery = useQuery({ queryKey: ['inventory-days', companyId], queryFn: ({ signal }) => dailyOperationsApi.inventoryDays(companyId, signal), enabled: Boolean(companyId) });
  const requestsQuery = useQuery({ queryKey: ['restock', companyId], queryFn: ({ signal }) => dailyOperationsApi.restockRequests(companyId, signal), enabled: Boolean(companyId) });
  const registerMutation = useMutation({
    mutationFn: () => dailyOperationsApi.registerInventory(companyId, operationalToday(), (query.data ?? []).filter((item) => item.item_type !== 'material').map((item) => ({ item_id: item.id, expected_project_id: item.current_project_id ?? null, to_project_id: destinations[item.id] === undefined ? item.current_project_id ?? null : destinations[item.id] === 'warehouse' ? null : destinations[item.id] }))),
    onSuccess: () => {
      toast.success('Movimientos y lista de herramientas registrados para hoy');
      setDestinations({});
      void queryClient.invalidateQueries({ queryKey: ['inventory', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-days', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['daily-activity-plan', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['task-requirements', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['reports-advanced', companyId] });
    },
    onError: (error: Error) => { toast.error(error.message); void query.refetch(); },
  });
  const requestMutation = useMutation({
    mutationFn: () => dailyOperationsApi.requestRestock(companyId, requestProject === 'warehouse' ? null : requestProject, requestName, requestQuantity, requestNote),
    onSuccess: () => { toast.success('Solicitud registrada'); setRestockOpen(false); setRequestName(''); setRequestNote(''); void queryClient.invalidateQueries({ queryKey: ['restock', companyId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const fulfillMutation = useMutation({
    mutationFn: (id: string) => dailyOperationsApi.fulfillRestock(companyId, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['restock', companyId] }),
    onError: (error: Error) => toast.error(error.message),
  });
  const projects = asItems(projectsQuery.data).filter((project) => project.status === 'active');
  const allProjects = asItems(projectsQuery.data);
  const movable = (query.data ?? []).filter((item) => item.item_type !== 'material');
  const changed = movable.filter((item) => destinations[item.id] !== undefined && destinations[item.id] !== (item.current_project_id ?? 'warehouse')).length;
  const latest = daysQuery.data?.find((day) => day.snapshot_date === operationalToday());

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
    <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Ubicación por obra · {operationalToday()}</h2><p className="text-xs text-muted-foreground">Cambia el destino de cada herramienta y confirma una sola vez al día. {latest ? `Último registro de hoy: ${new Date(latest.registered_at).toLocaleTimeString('es-PY')}` : 'Todavía no se registró la lista de hoy.'}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setHistoryOpen(!historyOpen)}><History className="h-4 w-4" /> Historial</Button><Button variant="outline" onClick={() => setRestockOpen(!restockOpen)}><Send className="h-4 w-4" /> Solicitar reposición/herramienta</Button>{canMove ? <Button disabled={registerMutation.isPending || query.isLoading || query.isError} onClick={() => registerMutation.mutate()}>Registrar movimientos{changed ? ` (${changed})` : ' (sin cambios)'}</Button> : null}</div></div>
    {query.isLoading ? <LoadingState label="Cargando inventario..." /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : movable.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...allProjects, { id: 'warehouse', name: 'Depósito' }].map((project) => { const contents = movable.filter((item) => (destinations[item.id] ?? item.current_project_id ?? 'warehouse') === project.id); return <Card key={project.id}><CardContent className="space-y-3 p-4"><h3 className="font-semibold">{project.name} <span className="text-xs font-normal text-muted-foreground">({contents.length})</span></h3><div className="max-h-80 space-y-2 overflow-y-auto">{contents.length ? contents.map((item) => <div key={item.id} className="rounded-lg border p-2"><div className="flex flex-wrap items-center gap-1"><p className="text-sm font-medium">{item.name}</p><Badge variant="muted">{TYPE_LABELS[item.item_type]}</Badge></div><p className="text-xs text-muted-foreground">{item.code} · {item.quantity} {item.unit}{item.serial_number ? ` · ${item.serial_number}` : ''} · {STATUS_LABELS[item.status]}</p>{canMove && !['relocation_pending','in_transit','maintenance','retired'].includes(item.status) ? <Select value={destinations[item.id] ?? item.current_project_id ?? 'warehouse'} onValueChange={(value) => setDestinations((current) => ({ ...current, [item.id]: value }))}><SelectTrigger className="mt-2 h-8" aria-label={`Destino de ${item.name}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="warehouse">Depósito</SelectItem>{projects.map((destination) => <SelectItem key={destination.id} value={destination.id}>{destination.name}</SelectItem>)}</SelectContent></Select> : null}</div>) : <p className="text-xs text-muted-foreground">Sin herramientas asignadas.</p>}</div></CardContent></Card>; })}</div> : <EmptyState title="Sin herramientas" description="Registra la primera herramienta o máquina." icon={<Wrench className="h-6 w-6" />} />}
    </section>
    {query.data?.some((item) => item.item_type === 'material') ? <Card><CardContent className="space-y-2 p-4"><h3 className="font-medium">Materiales registrados</h3><p className="text-xs text-muted-foreground">Se muestran aparte porque el movimiento de cantidades parciales no forma parte del tablero de herramientas.</p><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{query.data.filter((item) => item.item_type === 'material').map((item) => <p key={item.id} className="rounded-lg border p-2 text-sm">{item.name} · {item.quantity} {item.unit} · {item.code}</p>)}</div></CardContent></Card> : null}
    {restockOpen ? <Card><CardContent className="grid gap-3 p-4 md:grid-cols-4"><div><Label>Herramienta o material</Label><Input value={requestName} onChange={(e) => setRequestName(e.target.value)} /></div><div><Label>Cantidad</Label><Input type="number" min="0.001" step="0.001" value={requestQuantity} onChange={(e) => setRequestQuantity(Number(e.target.value))} /></div><div><Label>Destino</Label><Select value={requestProject} onValueChange={setRequestProject}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="warehouse">Depósito</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Motivo</Label><Input value={requestNote} onChange={(e) => setRequestNote(e.target.value)} /></div><Button disabled={requestMutation.isPending || requestName.trim().length < 2 || requestQuantity <= 0} onClick={() => requestMutation.mutate()}>Enviar solicitud</Button></CardContent></Card> : null}
    {requestsQuery.data?.length ? <Card><CardContent className="space-y-2 p-4"><h3 className="font-medium">Solicitudes de reposición</h3>{requestsQuery.data.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"><span>{request.name} · {request.quantity} · {projects.find((project) => project.id === request.project_id)?.name ?? 'Depósito'}{request.note ? ` · ${request.note}` : ''}</span><span>{request.status === 'fulfilled' ? 'Atendida' : 'Pendiente'} {canEdit && request.status === 'pending' ? <Button size="sm" variant="outline" onClick={() => fulfillMutation.mutate(request.id)}>Marcar atendida</Button> : null}</span></div>)}</CardContent></Card> : null}
    {historyOpen ? <Card><CardContent className="space-y-3 p-4"><h3 className="font-semibold">Historial de movimientos por fecha</h3>{daysQuery.data?.length ? daysQuery.data.map((day) => <details key={day.id} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{day.snapshot_date} · {day.items.length} herramientas · {new Date(day.registered_at).toLocaleTimeString('es-PY')}</summary><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{day.items.map((item) => <p key={item.item_id} className="text-sm">{item.name} ({item.code}) → {allProjects.find((project) => project.id === item.project_id)?.name ?? (item.project_id ? 'Obra no disponible' : 'Depósito')}</p>)}</div></details>) : <p className="text-sm text-muted-foreground">No hay registros diarios todavía.</p>}</CardContent></Card> : null}
  </div>;
}
