import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { membersApi } from '@/lib/api/modules';
import { taskLibraryApi, type DailyTaskInput } from '@/lib/api/taskLibrary';
import { projectsApi } from '@/lib/api/projects';
import { rubrosApi } from '@/lib/api/rubros';
import { asItems } from '@/lib/collection';
import type { DailyTaskStatus } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TaskFormDialog } from '@/pages/projects/TaskFormDialog';
import { DailyActivitiesBoard } from '@/pages/DailyActivitiesBoard';
import { AssignedTasks } from '@/pages/AssignedTasks';

const NONE = 'none';

function checklistFromLines(value: string) {
  return value
    .split('\n')
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title, sort_order) => ({ title, sort_order }));
}

function memberName(member: { full_name?: string | null; email: string }): string {
  return member.full_name || member.email;
}

export function TaskLibraryPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const canEditTasks = useCan('tasks.edit');
  const queryClient = useQueryClient();
  const [dailyTitle, setDailyTitle] = useState('');
  const [dailyDescription, setDailyDescription] = useState('');
  const [dailyChecklist, setDailyChecklist] = useState('');
  const [dailyAssigneeId, setDailyAssigneeId] = useState(NONE);
  const [saveAsDailyTemplate, setSaveAsDailyTemplate] = useState(false);
  const [autoRenewDaily, setAutoRenewDaily] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(NONE);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

  const membersQuery = useQuery({
    queryKey: ['members', companyId],
    queryFn: ({ signal }) => membersApi.list(companyId, signal),
    enabled: Boolean(companyId) && canEditTasks,
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
  const projectsQuery = useQuery({
    queryKey: ['projects', companyId, 'all'],
    queryFn: ({ signal }) => projectsApi.listAll(companyId, signal),
    enabled: Boolean(companyId) && canEditTasks,
  });
  const selectedProjectLevelsQuery = useQuery({
    queryKey: ['levels', companyId, selectedProjectId],
    queryFn: ({ signal }) => projectsApi.listLevels(companyId, selectedProjectId, signal),
    enabled: selectedProjectId !== NONE && canEditTasks,
  });
  const selectedProjectRubrosQuery = useQuery({
    queryKey: ['project-rubros', companyId, selectedProjectId],
    queryFn: ({ signal }) => rubrosApi.list(companyId, selectedProjectId, signal),
    enabled: selectedProjectId !== NONE && canEditTasks,
  });
  const projects = asItems(projectsQuery.data);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  const refreshDaily = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-tasks-summary', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['daily-tasks', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['daily-task-templates', companyId] });
  };
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
  const dailyStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DailyTaskStatus }) => taskLibraryApi.updateDailyTask(companyId, id, { status }),
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
    mutationFn: ({ templateId, autoRenew }: { templateId: string; autoRenew?: boolean }) =>
      taskLibraryApi.updateDailyTemplate(companyId, templateId, {
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
        <h1 className="text-2xl font-semibold">Tareas / actividades</h1>
        <p className="text-sm text-muted-foreground">Asigna tareas, distribuye el personal de cada día y verifica las herramientas por obra.</p>
      </div>

      <AssignedTasks key={`assigned-${companyId}`} companyId={companyId} />
      <DailyActivitiesBoard key={companyId} />

      {canEditTasks ? (
        <Card className="surface-glass border-primary/25">
          <CardHeader>
            <CardTitle className="text-base">Nueva tarea de obra</CardTitle>
            <p className="text-sm text-muted-foreground">Selecciona la obra y luego el sector; los niveles disponibles aparecerán dentro del formulario.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label>Obra</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar obra" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Seleccionar obra</SelectItem>
                  {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}{project.code ? ` · ${project.code}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!selectedProject || selectedProjectLevelsQuery.isLoading || selectedProjectRubrosQuery.isLoading} onClick={() => setTaskDialogOpen(true)}><Plus className="h-4 w-4" /> Abrir tarea</Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center gap-2"><CheckSquare2 className="h-5 w-5 text-primary" /><div><h2 className="text-lg font-semibold">Tareas diarias</h2><p className="text-sm text-muted-foreground">Trabajos independientes de una obra que se renuevan cuando los necesitas.</p></div></div>
        <Card className="border-primary/20">
          <CardHeader><CardTitle className="text-base">Nueva tarea diaria</CardTitle><p className="text-sm text-muted-foreground">Es independiente de una obra y aparece en el resumen principal de la persona asignada.</p></CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="daily-title">Título</Label><Input id="daily-title" value={dailyTitle} onChange={(event) => setDailyTitle(event.target.value)} placeholder="Ej.: Revisar seguridad del equipo" /></div>
              {canEditTasks ? <div className="space-y-1.5"><Label>Responsable</Label><Select value={dailyAssigneeId} onValueChange={setDailyAssigneeId}><SelectTrigger><SelectValue placeholder="Yo" /></SelectTrigger><SelectContent><SelectItem value={NONE}>Para mí</SelectItem>{(membersQuery.data ?? []).filter((member) => member.status === 'active').map((member) => <SelectItem key={member.user_id} value={member.user_id}>{memberName(member)}</SelectItem>)}</SelectContent></Select></div> : null}
              <div className="space-y-1.5"><Label htmlFor="daily-description">Descripción</Label><Textarea id="daily-description" rows={3} value={dailyDescription} onChange={(event) => setDailyDescription(event.target.value)} /></div>
            </div>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="space-y-1.5"><Label htmlFor="daily-checklist">Checklist</Label><Textarea id="daily-checklist" rows={5} value={dailyChecklist} onChange={(event) => setDailyChecklist(event.target.value)} placeholder={'Un control por línea\nRegistrar novedades\nCerrar jornada'} /></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={saveAsDailyTemplate} onChange={(event) => setSaveAsDailyTemplate(event.target.checked)} /><span><strong>Guardar como predeterminada diaria</strong><br /><span className="text-xs text-muted-foreground">Podrás reutilizarla para esta persona.</span></span></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={autoRenewDaily} onChange={(event) => { setAutoRenewDaily(event.target.checked); if (event.target.checked) setSaveAsDailyTemplate(true); }} /><span><strong>Renovar automáticamente cada día</strong><br /><span className="text-xs text-muted-foreground">Se crea una nueva copia pendiente cada día.</span></span></label>
              <Button className="w-full" disabled={dailyTaskMutation.isPending} onClick={saveDailyTask}>{dailyTaskMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Crear tarea diaria</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Tareas de hoy</CardTitle><p className="mt-1 text-xs text-muted-foreground">Marca el checklist sin salir del resumen.</p></div><Button size="icon" variant="ghost" aria-label="Actualizar tareas diarias" onClick={() => void dailyTasksQuery.refetch()}><RefreshCw className="h-4 w-4" /></Button></CardHeader><CardContent className="space-y-3">{dailyTasksQuery.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : (dailyTasksQuery.data ?? []).length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay tareas para hoy.</p> : (dailyTasksQuery.data ?? []).map((task) => <div key={task.id} className="rounded-md border p-3"><div className="flex items-start justify-between gap-2"><div><p className={task.status === 'completed' ? 'font-medium line-through text-muted-foreground' : 'font-medium'}>{task.title}</p>{task.description ? <p className="mt-1 text-xs text-muted-foreground">{task.description}</p> : null}</div><Button size="icon" variant="ghost" aria-label="Eliminar tarea diaria" onClick={() => deleteDailyTaskMutation.mutate(task.id)}><Trash2 className="h-4 w-4" /></Button></div>{task.checklist_items.length ? <div className="mt-3 space-y-2">{task.checklist_items.map((item) => <label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={item.status === 'completed'} disabled={dailyChecklistMutation.isPending} onChange={(event) => dailyChecklistMutation.mutate({ taskId: task.id, itemId: item.id, status: event.target.checked ? 'completed' : 'pending' })} /><span className={item.status === 'completed' ? 'line-through text-muted-foreground' : ''}>{item.title}</span></label>)}</div> : <Button size="sm" variant="outline" className="mt-2" disabled={dailyStatusMutation.isPending} onClick={() => dailyStatusMutation.mutate({ id: task.id, status: task.status === 'completed' ? 'pending' : 'completed' })}>{task.status === 'completed' ? 'Reabrir tarea' : 'Marcar completada'}</Button>}</div>)}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Predeterminadas diarias</CardTitle><p className="mt-1 text-xs text-muted-foreground">Activa la renovación cuando quieras que aparezcan automáticamente.</p></CardHeader><CardContent className="space-y-2">{dailyTemplatesQuery.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : (dailyTemplatesQuery.data ?? []).length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Todavía no hay predeterminadas diarias.</p> : (dailyTemplatesQuery.data ?? []).map((template) => <div key={template.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{template.title}</p><p className="mt-1 text-xs text-muted-foreground">{template.auto_renew_daily ? 'Se renueva todos los días' : 'Uso manual'} · {template.checklist_items.length} controles</p></div><div className="flex items-center gap-1"><Button size="sm" variant={template.auto_renew_daily ? 'secondary' : 'outline'} onClick={() => dailyTemplateMutation.mutate({ templateId: template.id, autoRenew: !template.auto_renew_daily })}>{template.auto_renew_daily ? 'Renovación activa' : 'Activar renovación'}</Button><Button size="icon" variant="ghost" aria-label="Eliminar predeterminada diaria" onClick={() => deleteDailyTemplateMutation.mutate(template.id)}><Trash2 className="h-4 w-4" /></Button></div></div>)}</CardContent></Card>
        </div>
      </section>

      {selectedProject && taskDialogOpen ? (
        <TaskFormDialog
          key={`global-task-${selectedProject.id}`}
          companyId={companyId}
          projectId={selectedProject.id}
          levels={asItems(selectedProjectLevelsQuery.data)}
          rubros={selectedProjectRubrosQuery.data ?? []}
          open={taskDialogOpen}
          onOpenChange={setTaskDialogOpen}
        />
      ) : null}
    </div>
  );
}
