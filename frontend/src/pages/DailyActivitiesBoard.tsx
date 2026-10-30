import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { dailyOperationsApi, operationalToday, type ActivityDefinition, type DailyActivityPlan } from '@/lib/api/dailyOperations';
import { inventoryApi, membersApi } from '@/lib/api/modules';
import { projectsApi } from '@/lib/api/projects';
import { TASK_STATUS } from '@/lib/labels';
import { asItems } from '@/lib/collection';
import type { TaskStatus } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Row {
  project_id: string;
  activity_definition_id: string | null;
  assigned_user_id: string | null;
  task_id: string | null;
  people_count: number;
  note: string | null;
}

function Verification({ entry }: { entry: DailyActivityPlan['entries'][number] }) {
  if (entry.verification === 'incomplete') return <span className="inline-flex items-center gap-1 text-amber-700"><CircleAlert className="h-4 w-4" /> Verificación incompleta</span>;
  if (entry.verification === 'missing') return <span className="text-red-700">Falta: {entry.missing_tools.join(', ')}</span>;
  return <span className="inline-flex items-center gap-1 text-green-700"><Check className="h-4 w-4" /> Herramientas disponibles</span>;
}

function sameRequirements(left: { name: string; quantity: number }[], right: ActivityDefinition['requirements']): boolean {
  return left.length === right.length && left.every((item, index) => item.name === right[index]?.name && Number(item.quantity) === Number(right[index]?.quantity));
}

export function DailyActivitiesBoard() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const canEdit = useCan('tasks.edit');
  const queryClient = useQueryClient();
  const [date, setDate] = useState(operationalToday);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loadedDay, setLoadedDay] = useState('');
  const [revision, setRevision] = useState<string | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [selectedDefinition, setSelectedDefinition] = useState<ActivityDefinition | null>(null);
  const [required, setRequired] = useState<{ name: string; quantity: number }[]>([]);
  const [toolName, setToolName] = useState('');
  const [toolQuantity, setToolQuantity] = useState(1);
  const [newProjectId, setNewProjectId] = useState('');
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [newPeopleCount, setNewPeopleCount] = useState(1);
  const [newNote, setNewNote] = useState('');

  const projectsQuery = useQuery({ queryKey: ['projects', companyId, 'all'], queryFn: ({ signal }) => projectsApi.listAll(companyId, signal), enabled: Boolean(companyId) });
  const membersQuery = useQuery({ queryKey: ['members', companyId], queryFn: ({ signal }) => membersApi.list(companyId, signal), enabled: Boolean(companyId) && canEdit });
  const definitionsQuery = useQuery({ queryKey: ['activity-definitions', companyId], queryFn: ({ signal }) => dailyOperationsApi.definitions(companyId, signal), enabled: Boolean(companyId) });
  const inventoryQuery = useQuery({ queryKey: ['inventory', companyId], queryFn: ({ signal }) => inventoryApi.list(companyId, signal), enabled: Boolean(companyId) });
  const planQuery = useQuery({ queryKey: ['daily-activity-plan', companyId, date], queryFn: ({ signal }) => dailyOperationsApi.plan(companyId, date, signal), enabled: Boolean(companyId), refetchInterval: 30_000 });
  const historyQuery = useQuery({ queryKey: ['daily-activity-history', companyId, historyOffset], queryFn: ({ signal }) => dailyOperationsApi.plans(companyId, signal, historyOffset), enabled: Boolean(companyId) && historyOpen });
  const projects = asItems(projectsQuery.data).filter((project) => project.status === 'active');
  const members = (membersQuery.data ?? []).filter((member) => member.status === 'active');
  const definitions = definitionsQuery.data ?? [];
  const inventoryNames = [...new Set((inventoryQuery.data ?? []).map((item) => item.name.trim()))].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (!planQuery.isSuccess || dirty) return;
    setLoadedDay(`${companyId}:${date}`);
    setRevision(planQuery.data.revision);
    setRows(planQuery.data.entries.map((entry) => ({ project_id: entry.project_id, activity_definition_id: entry.activity_definition_id, assigned_user_id: entry.assigned_user_id, task_id: entry.task_id, people_count: entry.people_count, note: entry.note })));
  }, [planQuery.data, planQuery.isSuccess, dirty, companyId, date]);

  const ready = loadedDay === `${companyId}:${date}` && planQuery.isSuccess && projectsQuery.isSuccess && definitionsQuery.isSuccess;
  const registered = Boolean(planQuery.data?.registered_at);
  const loadError = planQuery.error ?? projectsQuery.error ?? definitionsQuery.error;
  const refreshAssignments = (saved: DailyActivityPlan, message: string) => {
    toast.success(message);
    setDirty(false);
    setRevision(saved.revision);
    queryClient.setQueryData(['daily-activity-plan', companyId, date], saved);
    void queryClient.invalidateQueries({ queryKey: ['daily-activity-plan', companyId, date] });
    void queryClient.invalidateQueries({ queryKey: ['daily-activity-history', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['my-work-tasks', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['my-tasks-summary', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['task-overview', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] });
  };
  const saveMutation = useMutation({
    mutationFn: (nextRows: Row[] = rows) => {
      if (!ready) throw new Error('Espere a que termine de cargar el día antes de guardar.');
      return dailyOperationsApi.savePlan(companyId, date, nextRows, revision);
    },
    onSuccess: (saved) => refreshAssignments(saved, saved.inventory_registered_at ? 'Actividades guardadas y verificadas' : 'Actividades guardadas. La verificación queda incompleta hasta registrar el inventario de hoy.'),
    onError: (error: Error) => toast.error(error.message),
  });
  const registerMutation = useMutation({
    mutationFn: () => {
      if (!ready || dirty || !revision) throw new Error('Guarde y revise el borrador antes de registrarlo.');
      return dailyOperationsApi.registerPlan(companyId, date, revision);
    },
    onSuccess: (saved) => refreshAssignments(saved, 'Informe diario registrado'),
    onError: (error: Error) => toast.error(error.message),
  });
  const addMutation = useMutation({
    mutationFn: async () => {
      if (!ready || registered) throw new Error('El día no está disponible para editar.');
      const normalized = title.trim();
      if (normalized.length < 2 || !newProjectId || !newAssigneeId || newPeopleCount <= 0) throw new Error('Completa actividad, obra, responsable y cantidad de personal.');
      let definition = definitions.find((item) => item.title.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0) ?? selectedDefinition;
      if (!definition) definition = await dailyOperationsApi.createDefinition(companyId, normalized, required);
      else if (definition.title !== normalized || !sameRequirements(required, definition.requirements)) definition = await dailyOperationsApi.updateDefinition(companyId, definition.id, normalized, required);
      const nextRows = [...rows, { project_id: newProjectId, activity_definition_id: definition.id, assigned_user_id: newAssigneeId, task_id: null, people_count: newPeopleCount, note: newNote.trim() || null }];
      return dailyOperationsApi.savePlan(companyId, date, nextRows, revision);
    },
    onSuccess: (saved) => {
      setTitle(''); setSelectedDefinition(null); setRequired([]); setToolName(''); setNewProjectId(''); setNewAssigneeId(''); setNewPeopleCount(1); setNewNote('');
      void queryClient.invalidateQueries({ queryKey: ['activity-definitions', companyId] });
      refreshAssignments(saved, 'Actividad asignada y notificación preparada para el responsable');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleTitle(value: string) {
    setTitle(value);
    const match = definitions.find((item) => item.title.localeCompare(value.trim(), undefined, { sensitivity: 'accent' }) === 0) ?? null;
    if (match && match.id !== selectedDefinition?.id) {
      setSelectedDefinition(match);
      setRequired(match.requirements.map((requirement) => ({ name: requirement.name, quantity: Number(requirement.quantity) })));
    } else if (!match) setSelectedDefinition(null);
  }
  function changeRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, position) => position === index ? { ...row, ...patch } : row));
    setDirty(true);
  }

  const busy = saveMutation.isPending || registerMutation.isPending || addMutation.isPending;
  const readOnly = !canEdit || !ready || busy || registered;
  const plan = planQuery.data;

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Plan diario de actividades</h2><p className="text-sm text-muted-foreground">Asigna la actividad a una obra y una persona. Al guardarla se crea su tarea y aparece en su perfil.</p></div><div><Label htmlFor="activity-date">Fecha</Label><Input id="activity-date" type="date" value={date} disabled={busy} onChange={(event) => { if (!event.target.value || (dirty && !window.confirm('Hay cambios sin guardar. ¿Cambiar de día y descartarlos?'))) return; setDate(event.target.value); setLoadedDay(''); setRows([]); setDirty(false); }} /></div></div>
    {loadError ? <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">No se pudo cargar el día. <Button variant="outline" onClick={() => { void planQuery.refetch(); void projectsQuery.refetch(); void definitionsQuery.refetch(); }}>Reintentar</Button></p> : !ready ? <p role="status">Cargando actividades…</p> : null}
    {ready && !plan?.inventory_registered_at ? <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Todavía no se registró el inventario del {date}. Las tareas pueden asignarse, pero la verificación figurará incompleta.</p> : plan?.inventory_registered_at ? <p className="text-xs text-green-700">Herramientas verificadas con el registro del {date}.</p> : null}

    {canEdit && !registered ? <Card><CardContent className="space-y-4 p-4"><div><h3 className="font-semibold">Nueva actividad para el día</h3><p className="text-xs text-muted-foreground">Escribe para buscar actividades anteriores. Al elegir una se cargan sus herramientas y puedes añadir otras.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><div className="xl:col-span-2"><Label htmlFor="activity-title">Actividad</Label><Input id="activity-title" list="activity-suggestions" value={title} onChange={(event) => handleTitle(event.target.value)} placeholder="Ej.: Colocación de cabos" /><datalist id="activity-suggestions">{definitions.map((definition) => <option key={definition.id} value={definition.title} />)}</datalist></div><div><Label>Obra</Label><Select value={newProjectId} onValueChange={setNewProjectId}><SelectTrigger><SelectValue placeholder="Seleccionar obra" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Responsable</Label><Select value={newAssigneeId} onValueChange={setNewAssigneeId}><SelectTrigger><SelectValue placeholder="Seleccionar personal" /></SelectTrigger><SelectContent>{members.map((member) => <SelectItem key={member.user_id} value={member.user_id}>{member.full_name || member.email}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="activity-people">Cantidad de personal</Label><Input id="activity-people" type="number" min="1" value={newPeopleCount} onChange={(event) => setNewPeopleCount(Number(event.target.value))} /></div><div className="md:col-span-2 xl:col-span-3"><Label htmlFor="activity-note">Indicaciones</Label><Input id="activity-note" value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Opcional" /></div></div><div><Label>Herramientas y materiales</Label><div className="flex flex-wrap gap-2"><Select value={toolName} onValueChange={setToolName}><SelectTrigger className="w-[240px]"><SelectValue placeholder="Añadir herramienta" /></SelectTrigger><SelectContent>{inventoryNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select><Input className="w-24" type="number" min="0.001" step="0.001" value={toolQuantity} onChange={(event) => setToolQuantity(Number(event.target.value))} aria-label="Cantidad requerida" /><Button variant="outline" disabled={!toolName || toolQuantity <= 0 || required.some((item) => item.name === toolName)} onClick={() => setRequired((current) => [...current, { name: toolName, quantity: toolQuantity }])}><Plus className="h-4 w-4" /> Añadir</Button></div><div className="mt-2 flex flex-wrap gap-2">{required.map((item) => <Button key={item.name} size="sm" variant="secondary" onClick={() => setRequired((current) => current.filter((row) => row.name !== item.name))}>{item.name} × {item.quantity} · Quitar</Button>)}</div></div><Button disabled={busy || title.trim().length < 2 || !newProjectId || !newAssigneeId} onClick={() => addMutation.mutate()}><Plus className="h-4 w-4" /> Asignar actividad y notificar</Button></CardContent></Card> : null}

    <Card><CardContent className="space-y-3 overflow-x-auto p-4"><div className="flex items-center justify-between"><h3 className="font-medium">Actividades del {date}</h3><span className="text-sm">Total de personal: {rows.reduce((sum, row) => sum + row.people_count, 0)}</span></div><table className="w-full min-w-[980px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Obra</th><th className="p-2">Actividad</th><th className="p-2">Responsable</th><th className="p-2">Personal</th><th className="p-2">Herramientas</th><th className="p-2">Estado</th><th className="p-2">Acción</th></tr></thead><tbody>{rows.map((row, index) => { const saved = plan?.entries.find((entry) => entry.task_id === row.task_id) ?? plan?.entries[index]; const activityTitle = definitions.find((definition) => definition.id === row.activity_definition_id)?.title ?? saved?.activity_title ?? 'Sin actividad'; const status = saved?.task_status as TaskStatus | undefined; const state = status && TASK_STATUS[status]; return <tr key={row.task_id ?? `${row.project_id}-${index}`} className="border-b"><td className="p-2">{projects.find((project) => project.id === row.project_id)?.name ?? saved?.project_name ?? 'Obra no activa'}</td><td className="p-2">{activityTitle}</td><td className="p-2">{members.find((member) => member.user_id === row.assigned_user_id)?.full_name || members.find((member) => member.user_id === row.assigned_user_id)?.email || saved?.assigned_user_name || 'Sin asignar'}</td><td className="p-2"><Input aria-label={`Personal para ${activityTitle}`} className="w-20" type="number" min="1" value={row.people_count} disabled={readOnly} onChange={(event) => changeRow(index, { people_count: Number(event.target.value) })} /></td><td className="p-2">{saved ? <Verification entry={saved} /> : <span className="text-amber-700">Guardar para verificar</span>}</td><td className="p-2">{state ? <Badge variant={state.variant}>{status === 'custom' && saved?.custom_status_label ? saved.custom_status_label : state.label}</Badge> : <Badge variant="muted">Pendiente de guardar</Badge>}</td><td className="p-2">{canEdit && !registered ? <Button variant="ghost" size="icon" aria-label="Quitar actividad" disabled={readOnly} onClick={() => { setRows((current) => current.filter((_, position) => index !== position)); setDirty(true); }}><Trash2 className="h-4 w-4" /></Button> : null}</td></tr>; })}</tbody></table>{!rows.length ? <p className="text-sm text-muted-foreground">Todavía no hay actividades asignadas para este día.</p> : null}{canEdit && !registered && rows.length ? <div className="flex flex-wrap gap-2"><Button disabled={!ready || busy || !dirty} onClick={() => saveMutation.mutate(rows)}><Save className="h-4 w-4" /> Guardar cambios</Button><Button variant="outline" disabled={!ready || !plan?.id || dirty || busy} onClick={() => registerMutation.mutate()}>Registrar actividades</Button></div> : registered ? <p className="text-xs text-muted-foreground">Informe registrado. Las personas asignadas aún pueden actualizar el estado de sus tareas.</p> : null}</CardContent></Card>
    <Button variant="outline" onClick={() => setHistoryOpen(!historyOpen)}>Mostrar registro de actividades</Button>{historyOpen ? <Card><CardContent className="space-y-2 p-4">{historyQuery.isPending ? <p>Cargando registros…</p> : historyQuery.isError ? <p role="alert">No se pudo cargar el registro. <Button onClick={() => void historyQuery.refetch()}>Reintentar</Button></p> : historyQuery.data?.length ? historyQuery.data.map((report) => <details key={report.plan_date} className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">{report.plan_date} · {report.total_people} personas · {report.registered_at ? 'Registrado' : 'Borrador'} · {report.inventory_registered_at ? 'Herramientas verificadas' : 'Verificación incompleta'}</summary><div className="mt-2 space-y-1 text-sm">{report.entries.map((entry, index) => <p key={entry.task_id ?? index}>{entry.project_name} · {entry.activity_title ?? 'Sin actividad'} · {entry.assigned_user_name ?? 'Sin responsable'} · {entry.people_count} personas · <Verification entry={entry} /></p>)}</div></details>) : <p className="text-sm text-muted-foreground">Aún no hay informes.</p>}<div className="flex gap-2"><Button variant="outline" disabled={historyOffset === 0 || historyQuery.isFetching} onClick={() => setHistoryOffset(Math.max(0, historyOffset - 30))}>Más recientes</Button><Button variant="outline" disabled={historyQuery.isFetching || (historyQuery.data?.length ?? 0) < 30} onClick={() => setHistoryOffset(historyOffset + 30)}>Más antiguos</Button></div></CardContent></Card> : null}
  </section>;
}
