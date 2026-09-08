import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare2,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { inventoryApi, membersApi } from '@/lib/api/modules';
import {
  taskLibraryApi,
  type DailyTaskInput,
  type TaskTemplateInput,
} from '@/lib/api/taskLibrary';
import type { DailyTaskStatus, TaskPriority, TaskTemplate, TaskType } from '@/types/api';
import { TASK_PRIORITY_OPTIONS, TASK_TYPE_OPTIONS } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const NONE = 'none';

function checklistFromLines(value: string) {
  return value
    .split('\n')
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title, sort_order) => ({ title, sort_order }));
}

function checklistToLines(items: Array<{ title: string }>): string {
  return items.map((item) => item.title).join('\n');
}

function memberName(member: { full_name?: string | null; email: string }): string {
  return member.full_name || member.email;
}

export function TaskLibraryPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const canManageTemplates = useCan('tasks.edit');
  const queryClient = useQueryClient();
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateType, setTemplateType] = useState<TaskType>('work');
  const [templatePriority, setTemplatePriority] = useState<TaskPriority>('normal');
  const [templateLocation, setTemplateLocation] = useState('');
  const [templateInventoryIds, setTemplateInventoryIds] = useState<string[]>([]);
  const [templateChecklist, setTemplateChecklist] = useState('');

  const [dailyTitle, setDailyTitle] = useState('');
  const [dailyDescription, setDailyDescription] = useState('');
  const [dailyChecklist, setDailyChecklist] = useState('');
  const [dailyAssigneeId, setDailyAssigneeId] = useState(NONE);
  const [saveAsDailyTemplate, setSaveAsDailyTemplate] = useState(false);
  const [autoRenewDaily, setAutoRenewDaily] = useState(false);

  const templatesQuery = useQuery({
    queryKey: ['task-templates', companyId, 'all'],
    queryFn: ({ signal }) => taskLibraryApi.listTemplates(companyId, false, signal),
    enabled: Boolean(companyId),
  });
  const inventoryQuery = useQuery({
    queryKey: ['inventory', companyId],
    queryFn: ({ signal }) => inventoryApi.list(companyId, signal),
    enabled: Boolean(companyId) && canManageTemplates,
  });
  const membersQuery = useQuery({
    queryKey: ['members', companyId],
    queryFn: ({ signal }) => membersApi.list(companyId, signal),
    enabled: Boolean(companyId) && canManageTemplates,
  });
  const selectedDailyAssignee = dailyAssigneeId === NONE ? undefined : dailyAssigneeId;
  const dailyTasksQuery = useQuery({
    queryKey: ['daily-tasks', companyId, selectedDailyAssignee],
    queryFn: ({ signal }) => taskLibraryApi.listDailyTasks(companyId, { assigned_user_id: selectedDailyAssignee }, signal),
    enabled: Boolean(companyId),
    refetchInterval: 60_000,
  });
  const dailyTemplatesQuery = useQuery({
    queryKey: ['daily-task-templates', companyId, selectedDailyAssignee],
    queryFn: ({ signal }) => taskLibraryApi.listDailyTemplates(companyId, selectedDailyAssignee, signal),
    enabled: Boolean(companyId),
  });

  const equipment = useMemo(
    () => (inventoryQuery.data ?? []).filter((item) => item.item_type === 'machine' || item.item_type === 'tool'),
    [inventoryQuery.data],
  );
  const selectedTemplateEquipment = useMemo(
    () => templateInventoryIds
      .map((id) => equipment.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [equipment, templateInventoryIds],
  );

  const refreshTemplates = () => {
    void queryClient.invalidateQueries({ queryKey: ['task-templates', companyId] });
  };
  const refreshDaily = () => {
    void queryClient.invalidateQueries({ queryKey: ['daily-tasks', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['daily-task-templates', companyId] });
  };
  const resetTemplateForm = () => {
    setEditingTemplateId(null);
    setTemplateTitle('');
    setTemplateDescription('');
    setTemplateType('work');
    setTemplatePriority('normal');
    setTemplateLocation('');
    setTemplateInventoryIds([]);
    setTemplateChecklist('');
  };
  const editTemplate = (template: TaskTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateTitle(template.title);
    setTemplateDescription(template.description ?? '');
    setTemplateType(template.task_type);
    setTemplatePriority(template.priority);
    setTemplateLocation(template.default_location_text ?? '');
    setTemplateInventoryIds(
      template.resources
        .map((resource) => resource.inventory_item_id)
        .filter((id): id is string => Boolean(id)),
    );
    setTemplateChecklist(checklistToLines(template.checklist_items));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const templateMutation = useMutation({
    mutationFn: (input: TaskTemplateInput) => editingTemplateId
      ? taskLibraryApi.updateTemplate(companyId, editingTemplateId, input)
      : taskLibraryApi.createTemplate(companyId, input),
    onSuccess: () => {
      toast.success(editingTemplateId ? 'Tarea predeterminada actualizada' : 'Tarea predeterminada creada');
      resetTemplateForm();
      refreshTemplates();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteTemplateMutation = useMutation({
    mutationFn: (templateId: string) => taskLibraryApi.deleteTemplate(companyId, templateId),
    onSuccess: () => {
      toast.success('Tarea predeterminada eliminada');
      refreshTemplates();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const dailyTaskMutation = useMutation({
    mutationFn: (input: DailyTaskInput) => taskLibraryApi.createDailyTask(companyId, input),
    onSuccess: () => {
      toast.success(autoRenewDaily ? 'Tarea diaria creada y programada para renovarse' : 'Tarea diaria creada');
      setDailyTitle('');
      setDailyDescription('');
      setDailyChecklist('');
      setSaveAsDailyTemplate(false);
      setAutoRenewDaily(false);
      refreshDaily();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const dailyChecklistMutation = useMutation({
    mutationFn: ({ taskId, itemId, status }: { taskId: string; itemId: string; status: DailyTaskStatus }) =>
      taskLibraryApi.updateDailyChecklist(companyId, taskId, itemId, status),
    onSuccess: refreshDaily,
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteDailyTaskMutation = useMutation({
    mutationFn: (taskId: string) => taskLibraryApi.deleteDailyTask(companyId, taskId),
    onSuccess: () => {
      toast.success('Tarea diaria eliminada');
      refreshDaily();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const dailyTemplateMutation = useMutation({
    mutationFn: ({ templateId, active, autoRenew }: { templateId: string; active?: boolean; autoRenew?: boolean }) =>
      taskLibraryApi.updateDailyTemplate(companyId, templateId, {
        ...(active === undefined ? {} : { is_active: active }),
        ...(autoRenew === undefined ? {} : { auto_renew_daily: autoRenew }),
      }),
    onSuccess: refreshDaily,
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteDailyTemplateMutation = useMutation({
    mutationFn: (templateId: string) => taskLibraryApi.deleteDailyTemplate(companyId, templateId),
    onSuccess: () => {
      toast.success('Predeterminada diaria eliminada');
      refreshDaily();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveTemplate = () => {
    if (templateTitle.trim().length < 2) {
      toast.error('Indica el título de la tarea predeterminada');
      return;
    }
    templateMutation.mutate({
      title: templateTitle.trim(),
      description: templateDescription.trim() || null,
      task_type: templateType,
      priority: templatePriority,
      default_location_text: templateLocation.trim() || null,
      resources: selectedTemplateEquipment.map((item, sort_order) => ({
        inventory_item_id: item.id,
        description: `${item.code} · ${item.name}`,
        required_quantity: 1,
        unit: item.unit,
        sort_order,
      })),
      checklist_items: checklistFromLines(templateChecklist),
    });
  };
  const saveDailyTask = () => {
    if (dailyTitle.trim().length < 2) {
      toast.error('Indica el título de la tarea diaria');
      return;
    }
    dailyTaskMutation.mutate({
      title: dailyTitle.trim(),
      description: dailyDescription.trim() || null,
      assigned_user_id: selectedDailyAssignee,
      checklist_items: checklistFromLines(dailyChecklist),
      save_as_template: saveAsDailyTemplate || autoRenewDaily,
      auto_renew_daily: autoRenewDaily,
    });
  };

  if (!companyId) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tareas</h1>
        <p className="text-sm text-muted-foreground">Define trabajos recurrentes con sus herramientas y organiza las tareas personales de cada día.</p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates"><ClipboardList className="mr-2 h-4 w-4" />Predeterminadas de obra</TabsTrigger>
          <TabsTrigger value="daily"><CheckSquare2 className="mr-2 h-4 w-4" />Tareas diarias</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4">
          {!canManageTemplates ? (
            <Card><CardContent className="p-4 text-sm text-muted-foreground">Tu rol puede usar las tareas predeterminadas al crear una tarea en una obra.</CardContent></Card>
          ) : (
            <Card className="border-primary/20">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{editingTemplateId ? 'Editar tarea predeterminada' : 'Nueva tarea predeterminada'}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Al seleccionarla dentro de una obra se cargan el checklist y todas las herramientas.</p>
                </div>
                {editingTemplateId ? <Button size="sm" variant="ghost" onClick={resetTemplateForm}>Cancelar edición</Button> : null}
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="space-y-1.5"><Label htmlFor="template-title">Título</Label><Input id="template-title" value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} placeholder="Ej.: Hormigonado de losa" /></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label>Tipo</Label><Select value={templateType} onValueChange={(value) => setTemplateType(value as TaskType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TASK_TYPE_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label>Prioridad</Label><Select value={templatePriority} onValueChange={(value) => setTemplatePriority(value as TaskPriority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TASK_PRIORITY_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="template-location">Ubicación habitual</Label><Input id="template-location" value={templateLocation} onChange={(event) => setTemplateLocation(event.target.value)} placeholder="Ej.: Losa, sector norte" /></div>
                  <div className="space-y-1.5"><Label htmlFor="template-description">Descripción</Label><Textarea id="template-description" rows={3} value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} /></div>
                </div>
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div><Label>Herramientas y máquinas requeridas</Label><p className="mt-1 text-xs text-muted-foreground">Puedes cargar varias; se verificará su disponibilidad al asignar la tarea.</p></div>
                  <Select value={NONE} onValueChange={(id) => setTemplateInventoryIds((current) => id === NONE || current.includes(id) ? current : [...current, id])}>
                    <SelectTrigger><SelectValue placeholder="Agregar herramienta o máquina" /></SelectTrigger>
                    <SelectContent><SelectItem value={NONE}>Seleccionar equipo</SelectItem>{equipment.filter((item) => !templateInventoryIds.includes(item.id)).map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {item.name}</SelectItem>)}</SelectContent>
                  </Select>
                  {selectedTemplateEquipment.length ? <div className="flex flex-wrap gap-2">{selectedTemplateEquipment.map((item) => <span key={item.id} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"><Wrench className="h-3 w-3" />{item.code} · {item.name}<button type="button" aria-label={`Quitar ${item.name}`} onClick={() => setTemplateInventoryIds((current) => current.filter((id) => id !== item.id))}><X className="h-3.5 w-3.5" /></button></span>)}</div> : <p className="text-xs text-muted-foreground">Sin herramientas preasignadas.</p>}
                  <div className="space-y-1.5"><Label htmlFor="template-checklist">Checklist estándar</Label><Textarea id="template-checklist" rows={5} value={templateChecklist} onChange={(event) => setTemplateChecklist(event.target.value)} placeholder={'Un control por línea\nVerificar anclajes\nRevisar cabos'} /><p className="text-xs text-muted-foreground">Cada línea se crea como un control dentro de la tarea.</p></div>
                  <Button className="w-full" disabled={templateMutation.isPending} onClick={saveTemplate}>{templateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{editingTemplateId ? 'Guardar cambios' : 'Guardar predeterminada'}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {templatesQuery.isLoading ? <p className="text-sm text-muted-foreground">Cargando tareas predeterminadas…</p> : (templatesQuery.data ?? []).length === 0 ? <Card><CardContent className="p-4 text-sm text-muted-foreground">Aún no hay tareas predeterminadas.</CardContent></Card> : (templatesQuery.data ?? []).map((template) => (
              <Card key={template.id} className={!template.is_active ? 'opacity-60' : ''}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{template.title}</p><Badge variant={template.is_active ? 'success' : 'muted'}>{template.is_active ? 'Activa' : 'Inactiva'}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{template.resources.length} herramienta(s) · {template.checklist_items.length} control(es)</p></div>{canManageTemplates ? <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => editTemplate(template)}>Editar</Button><Button size="icon" variant="ghost" aria-label="Eliminar tarea predeterminada" onClick={() => deleteTemplateMutation.mutate(template.id)}><Trash2 className="h-4 w-4" /></Button></div> : null}</div>
                  {template.description ? <p className="text-sm text-muted-foreground">{template.description}</p> : null}
                  {template.resources.length ? <div className="flex flex-wrap gap-1.5">{template.resources.map((resource) => <Badge key={resource.id} variant="outline">{resource.inventory_code || resource.description}</Badge>)}</div> : null}
                  {template.checklist_items.length ? <p className="text-xs text-muted-foreground">Checklist: {template.checklist_items.map((item) => item.title).join(' · ')}</p> : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="daily" className="space-y-4">
          <Card className="border-primary/20">
            <CardHeader><CardTitle className="text-base">Nueva tarea diaria</CardTitle><p className="text-sm text-muted-foreground">Es independiente de una obra y aparece en el resumen principal de la persona asignada.</p></CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1.5"><Label htmlFor="daily-title">Título</Label><Input id="daily-title" value={dailyTitle} onChange={(event) => setDailyTitle(event.target.value)} placeholder="Ej.: Revisar seguridad del equipo" /></div>
                {canManageTemplates ? <div className="space-y-1.5"><Label>Responsable</Label><Select value={dailyAssigneeId} onValueChange={setDailyAssigneeId}><SelectTrigger><SelectValue placeholder="Yo" /></SelectTrigger><SelectContent><SelectItem value={NONE}>Para mí</SelectItem>{(membersQuery.data ?? []).filter((member) => member.status === 'active').map((member) => <SelectItem key={member.user_id} value={member.user_id}>{memberName(member)}</SelectItem>)}</SelectContent></Select></div> : null}
                <div className="space-y-1.5"><Label htmlFor="daily-description">Descripción</Label><Textarea id="daily-description" rows={3} value={dailyDescription} onChange={(event) => setDailyDescription(event.target.value)} /></div>
              </div>
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <div className="space-y-1.5"><Label htmlFor="daily-checklist">Checklist</Label><Textarea id="daily-checklist" rows={5} value={dailyChecklist} onChange={(event) => setDailyChecklist(event.target.value)} placeholder={'Un control por línea\nRegistrar novedades\nCerrar jornada'} /></div>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={saveAsDailyTemplate} onChange={(event) => setSaveAsDailyTemplate(event.target.checked)} /><span><strong>Guardar como predeterminada</strong><br /><span className="text-xs text-muted-foreground">Podrás reutilizarla para esta persona.</span></span></label>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={autoRenewDaily} onChange={(event) => { setAutoRenewDaily(event.target.checked); if (event.target.checked) setSaveAsDailyTemplate(true); }} /><span><strong>Renovar automáticamente cada día</strong><br /><span className="text-xs text-muted-foreground">Se crea una nueva copia pendiente cada día.</span></span></label>
                <Button className="w-full" disabled={dailyTaskMutation.isPending} onClick={saveDailyTask}>{dailyTaskMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Crear tarea diaria</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Tareas de hoy</CardTitle><p className="mt-1 text-xs text-muted-foreground">Marca el checklist sin salir del resumen.</p></div><Button size="icon" variant="ghost" aria-label="Actualizar tareas diarias" onClick={() => void dailyTasksQuery.refetch()}><RefreshCw className="h-4 w-4" /></Button></CardHeader><CardContent className="space-y-3">{dailyTasksQuery.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : (dailyTasksQuery.data ?? []).length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay tareas para hoy.</p> : (dailyTasksQuery.data ?? []).map((task) => <div key={task.id} className="rounded-md border p-3"><div className="flex items-start justify-between gap-2"><div><p className={task.status === 'completed' ? 'font-medium line-through text-muted-foreground' : 'font-medium'}>{task.title}</p>{task.description ? <p className="mt-1 text-xs text-muted-foreground">{task.description}</p> : null}</div><Button size="icon" variant="ghost" aria-label="Eliminar tarea diaria" onClick={() => deleteDailyTaskMutation.mutate(task.id)}><Trash2 className="h-4 w-4" /></Button></div>{task.checklist_items.length ? <div className="mt-3 space-y-2">{task.checklist_items.map((item) => <label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={item.status === 'completed'} disabled={dailyChecklistMutation.isPending} onChange={(event) => dailyChecklistMutation.mutate({ taskId: task.id, itemId: item.id, status: event.target.checked ? 'completed' : 'pending' })} /><span className={item.status === 'completed' ? 'line-through text-muted-foreground' : ''}>{item.title}</span></label>)}</div> : null}</div>)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Predeterminadas diarias</CardTitle><p className="mt-1 text-xs text-muted-foreground">Activa la renovación cuando quieras que aparezcan automáticamente.</p></CardHeader><CardContent className="space-y-2">{dailyTemplatesQuery.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : (dailyTemplatesQuery.data ?? []).length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Todavía no hay predeterminadas diarias.</p> : (dailyTemplatesQuery.data ?? []).map((template) => <div key={template.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{template.title}</p><p className="mt-1 text-xs text-muted-foreground">{template.auto_renew_daily ? 'Se renueva todos los días' : 'Uso manual'} · {template.checklist_items.length} controles</p></div><div className="flex items-center gap-1"><Button size="sm" variant={template.auto_renew_daily ? 'secondary' : 'outline'} onClick={() => dailyTemplateMutation.mutate({ templateId: template.id, autoRenew: !template.auto_renew_daily })}>{template.auto_renew_daily ? 'Renovación activa' : 'Activar renovación'}</Button><Button size="icon" variant="ghost" aria-label="Eliminar predeterminada diaria" onClick={() => deleteDailyTemplateMutation.mutate(template.id)}><Trash2 className="h-4 w-4" /></Button></div></div>)}</CardContent></Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
