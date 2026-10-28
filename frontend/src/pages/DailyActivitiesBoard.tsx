import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { dailyOperationsApi, operationalToday, type ActivityDefinition, type DailyActivityPlan } from '@/lib/api/dailyOperations';
import { inventoryApi } from '@/lib/api/modules';
import { projectsApi } from '@/lib/api/projects';
import { asItems } from '@/lib/collection';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Row {
  project_id: string;
  activity_definition_id: string | null;
  people_count: number;
  note: string | null;
}

function Verification({ entry }: { entry: DailyActivityPlan['entries'][number] }) {
  if (entry.verification === 'incomplete') return <span className="inline-flex items-center gap-1 text-amber-700"><CircleAlert className="h-4 w-4" /> Verificación incompleta</span>;
  if (entry.verification === 'missing') return <span className="text-red-700">Falta: {entry.missing_tools.join(', ')}</span>;
  return <span className="inline-flex items-center gap-1 text-green-700"><Check className="h-4 w-4" /> Herramientas disponibles</span>;
}

export function DailyActivitiesBoard() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const canEdit = useCan('tasks.edit');
  const queryClient = useQueryClient();
  const [date, setDate] = useState(operationalToday);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [editingDefinition, setEditingDefinition] = useState<ActivityDefinition | null>(null);
  const [title, setTitle] = useState('');
  const [required, setRequired] = useState<{ name: string; quantity: number }[]>([]);
  const [toolName, setToolName] = useState('');
  const [toolQuantity, setToolQuantity] = useState(1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const projectsQuery = useQuery({ queryKey: ['projects', companyId, { limit: 100 }], queryFn: ({ signal }) => projectsApi.list(companyId, { limit: 100 }, signal), enabled: Boolean(companyId) });
  const definitionsQuery = useQuery({ queryKey: ['activity-definitions', companyId], queryFn: ({ signal }) => dailyOperationsApi.definitions(companyId, signal), enabled: Boolean(companyId) });
  const inventoryQuery = useQuery({ queryKey: ['inventory', companyId], queryFn: ({ signal }) => inventoryApi.list(companyId, signal), enabled: Boolean(companyId) });
  const planQuery = useQuery({ queryKey: ['daily-activity-plan', companyId, date], queryFn: ({ signal }) => dailyOperationsApi.plan(companyId, date, signal), enabled: Boolean(companyId), refetchInterval: 30_000 });
  const historyQuery = useQuery({ queryKey: ['daily-activity-history', companyId], queryFn: ({ signal }) => dailyOperationsApi.plans(companyId, signal), enabled: Boolean(companyId) && historyOpen });
  const projects = asItems(projectsQuery.data).filter((project) => project.status === 'active');
  const definitions = definitionsQuery.data ?? [];
  const inventoryNames = [...new Set((inventoryQuery.data ?? []).filter((item) => item.item_type === 'machine' || item.item_type === 'tool').map((item) => item.name.trim()))].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (!planQuery.isSuccess || !projectsQuery.isSuccess || dirty) return;
    const saved = planQuery.data.entries.map((entry) => ({ project_id: entry.project_id, activity_definition_id: entry.activity_definition_id, people_count: entry.people_count, note: entry.note }));
    const active = asItems(projectsQuery.data).filter((project) => project.status === 'active');
    setRows(planQuery.data.registered_at ? saved : [
      ...saved,
      ...active.filter((project) => !saved.some((entry) => entry.project_id === project.id)).map((project) => ({ project_id: project.id, activity_definition_id: null, people_count: 0, note: null })),
    ]);
  }, [planQuery.data, planQuery.isSuccess, projectsQuery.data, projectsQuery.isSuccess, dirty]);

  function changeRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, position) => position === index ? { ...row, ...patch } : row));
    setDirty(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => dailyOperationsApi.savePlan(companyId, date, rows),
    onSuccess: (saved) => {
      toast.success(saved.inventory_registered_at ? 'Lista de actividades guardada y verificada' : 'Lista guardada. Verificación incompleta hasta registrar herramientas de hoy.');
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['daily-activity-plan', companyId, date] });
      void queryClient.invalidateQueries({ queryKey: ['daily-activity-history', companyId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const registerMutation = useMutation({
    mutationFn: () => dailyOperationsApi.registerPlan(companyId, date),
    onSuccess: (saved) => {
      toast.success(saved.inventory_registered_at ? 'Actividades registradas para el día' : 'Actividades registradas; falta registrar el inventario del mismo día');
      void queryClient.invalidateQueries({ queryKey: ['daily-activity-plan', companyId, date] });
      void queryClient.invalidateQueries({ queryKey: ['daily-activity-history', companyId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const definitionMutation = useMutation({
    mutationFn: () => editingDefinition ? dailyOperationsApi.updateDefinition(companyId, editingDefinition.id, title.trim(), required) : dailyOperationsApi.createDefinition(companyId, title.trim(), required),
    onSuccess: () => { toast.success('Actividad definida'); setDefinitionOpen(false); void queryClient.invalidateQueries({ queryKey: ['activity-definitions', companyId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  function editDefinition(definition: ActivityDefinition | null) {
    setEditingDefinition(definition);
    setTitle(definition?.title ?? '');
    setRequired(definition?.requirements.map((requirement) => ({ name: requirement.name, quantity: Number(requirement.quantity) })) ?? []);
    setDefinitionOpen(true);
  }
  const registered = Boolean(planQuery.data?.registered_at);
  const plan = planQuery.data;
  const verification = new Map<string, DailyActivityPlan['entries'][number]>();
  if (!dirty) plan?.entries.forEach((entry, index) => verification.set(String(index), entry));

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Plan diario de actividades</h2><p className="text-sm text-muted-foreground">Distribuye personal entre obras activas. Se comprueba el equipo según los movimientos registrados en la misma fecha.</p></div><div className="flex gap-2"><div><Label htmlFor="activity-date">Fecha</Label><Input id="activity-date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setRows([]); setDirty(false); }} /></div>{canEdit ? <Button variant="outline" onClick={() => editDefinition(null)}><Plus className="h-4 w-4" /> Definir actividad</Button> : null}</div></div>
    {!plan?.inventory_registered_at ? <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Aún no se registraron movimientos de herramientas el {date}. Podés guardar y registrar la lista, pero la verificación seguirá incompleta; no se usarán ubicaciones de ayer.</p> : <p className="text-xs text-green-700">Herramientas verificadas con el registro del {date} a las {new Date(plan.inventory_registered_at).toLocaleTimeString('es-PY')}.</p>}
    <div className="flex flex-wrap gap-2">{definitions.map((definition) => canEdit ? <Button key={definition.id} size="sm" variant="outline" onClick={() => editDefinition(definition)}>{definition.title} · {definition.requirements.length} herramientas</Button> : <span key={definition.id} className="rounded-lg border px-2 py-1 text-xs">{definition.title}</span>)}</div>
    {definitionOpen ? <Card><CardContent className="space-y-3 p-4"><h3 className="font-semibold">{editingDefinition ? 'Editar actividad' : 'Nueva actividad'}</h3><div><Label>Nombre</Label><Input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder="Ej.: Colocación de cabos" /></div><div><Label>Herramientas a utilizar</Label><div className="flex flex-wrap gap-2"><Select value={toolName} onValueChange={setToolName}><SelectTrigger className="w-[220px]"><SelectValue placeholder="Seleccionar herramienta" /></SelectTrigger><SelectContent>{inventoryNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select><Input className="w-24" type="number" min="0.001" step="0.001" value={toolQuantity} onChange={(event) => setToolQuantity(Number(event.target.value))} aria-label="Cantidad requerida" /><Button variant="outline" disabled={!toolName || toolQuantity <= 0 || required.some((item) => item.name === toolName)} onClick={() => setRequired((current) => [...current, { name: toolName, quantity: toolQuantity }])}>Añadir</Button></div><p className="mt-1 text-xs text-muted-foreground">Los nombres provienen de tu inventario; se suman las cantidades de equipos con el mismo nombre en la obra.</p></div><div className="flex flex-wrap gap-2">{required.map((item) => <Button key={item.name} size="sm" variant="secondary" onClick={() => setRequired((current) => current.filter((row) => row.name !== item.name))}>{item.name} × {item.quantity} · Quitar</Button>)}</div><div className="flex gap-2"><Button disabled={title.trim().length < 2 || definitionMutation.isPending} onClick={() => definitionMutation.mutate()}>Guardar definición</Button><Button variant="outline" onClick={() => setDefinitionOpen(false)}>Cancelar</Button></div></CardContent></Card> : null}
    <Card><CardContent className="space-y-3 overflow-x-auto p-4"><div className="flex items-center justify-between"><h3 className="font-medium">Actividades del {date}</h3><span className="text-sm">Total de personal: {rows.reduce((sum, row) => sum + row.people_count, 0)}</span></div><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Obra</th><th className="p-2">Descripción</th><th className="p-2">Cantidad de personas</th><th className="p-2">Verificación de herramientas</th><th className="p-2">Acción</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.project_id}-${index}`} className="border-b"><td className="p-2">{projects.find((project) => project.id === row.project_id)?.name ?? plan?.entries[index]?.project_name ?? 'Obra no activa'}</td><td className="p-2"><Select value={row.activity_definition_id ?? 'none'} disabled={!canEdit || registered} onValueChange={(value) => changeRow(index, { activity_definition_id: value === 'none' ? null : value, people_count: value === 'none' ? 0 : row.people_count })}><SelectTrigger className="w-[220px]"><SelectValue placeholder="Sin actividad" /></SelectTrigger><SelectContent><SelectItem value="none">Sin actividad</SelectItem>{definitions.map((definition) => <SelectItem key={definition.id} value={definition.id}>{definition.title}</SelectItem>)}</SelectContent></Select></td><td className="p-2"><Input className="w-24" type="number" min="0" value={row.people_count} disabled={!canEdit || registered} onChange={(event) => changeRow(index, { people_count: Number(event.target.value) })} /></td><td className="p-2">{verification.has(String(index)) ? <Verification entry={verification.get(String(index))!} /> : <span className="text-amber-700">Guardar para verificar</span>}</td><td className="p-2">{canEdit && !registered ? <Button variant="ghost" size="sm" onClick={() => { setRows((current) => current.filter((_, position) => index !== position)); setDirty(true); }}>Quitar</Button> : null}</td></tr>)}</tbody></table>{!rows.length ? <p className="text-sm text-muted-foreground">Añade una obra activa a la lista de este día.</p> : null}{canEdit && !registered ? <div className="flex flex-wrap gap-2"><Select onValueChange={(id) => { setRows((current) => [...current, { project_id: id, activity_definition_id: null, people_count: 0, note: null }]); setDirty(true); }}><SelectTrigger className="w-[240px]"><SelectValue placeholder="+ Agregar obra a la lista" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select><Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}><Save className="h-4 w-4" /> Guardar borrador</Button><Button variant="outline" disabled={!plan?.id || dirty || registerMutation.isPending} onClick={() => registerMutation.mutate()}>Registrar actividades</Button></div> : registered ? <p className="text-xs text-muted-foreground">Informe registrado. La distribución de personal no puede editarse después de registrarlo.</p> : null}</CardContent></Card>
    <Button variant="outline" onClick={() => setHistoryOpen(!historyOpen)}>Mostrar registro de actividades</Button>{historyOpen ? <Card><CardContent className="space-y-2 p-4">{historyQuery.data?.length ? historyQuery.data.map((report) => <details key={report.plan_date} className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">{report.plan_date} · {report.total_people} personas · {report.registered_at ? 'Registrado' : 'Borrador'} · {report.inventory_registered_at ? 'Herramientas verificadas' : 'Verificación incompleta'}</summary><div className="mt-2 space-y-1 text-sm">{report.entries.map((entry, index) => <p key={index}>{entry.project_name} · {entry.activity_title ?? 'Sin actividad'} · {entry.people_count} personas · <Verification entry={entry} /></p>)}</div></details>) : <p className="text-sm text-muted-foreground">Aún no hay informes.</p>}</CardContent></Card> : null}
  </section>;
}
