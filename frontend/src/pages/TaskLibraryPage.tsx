import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { projectsApi } from '@/lib/api/projects';
import { rubrosApi } from '@/lib/api/rubros';
import { asItems } from '@/lib/collection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TaskFormDialog } from '@/pages/projects/TaskFormDialog';
import { DailyActivitiesBoard } from '@/pages/DailyActivitiesBoard';
import { AssignedTasks } from '@/pages/AssignedTasks';
import { TaskOverview } from '@/pages/TaskOverview';

const NONE = 'none';

export function TaskLibraryPage() {
  const { activeCompanyId, activeMembership } = useCompany();
  const companyId = activeCompanyId as string;
  const canEditTasks = useCan('tasks.edit');
  const [selectedProjectId, setSelectedProjectId] = useState(NONE);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
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
  const canPlanActivities = activeMembership?.role === 'owner' || activeMembership?.role === 'engineer';

  if (!companyId) return null;

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Tareas / actividades</h1><p className="text-sm text-muted-foreground">Cada responsable encuentra aquí lo asignado, actualiza su estado y recibe los avisos correspondientes.</p></div>
    <AssignedTasks key={`assigned-${companyId}`} companyId={companyId} />
    {canPlanActivities ? <><TaskOverview companyId={companyId} /><DailyActivitiesBoard key={companyId} /></> : null}

    {canEditTasks ? <Card className="surface-glass border-primary/25"><CardHeader><CardTitle className="text-base">Nueva tarea de obra</CardTitle><p className="text-sm text-muted-foreground">Selecciona la obra y luego el sector; los niveles disponibles aparecerán dentro del formulario.</p></CardHeader><CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1 space-y-1.5"><Label>Obra</Label><Select value={selectedProjectId} onValueChange={setSelectedProjectId}><SelectTrigger><SelectValue placeholder="Seleccionar obra" /></SelectTrigger><SelectContent><SelectItem value={NONE}>Seleccionar obra</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}{project.code ? ` · ${project.code}` : ''}</SelectItem>)}</SelectContent></Select></div><Button disabled={!selectedProject || selectedProjectLevelsQuery.isLoading || selectedProjectRubrosQuery.isLoading} onClick={() => setTaskDialogOpen(true)}><Plus className="h-4 w-4" /> Abrir tarea</Button></CardContent></Card> : null}

    {selectedProject && taskDialogOpen ? <TaskFormDialog key={`global-task-${selectedProject.id}`} companyId={companyId} projectId={selectedProject.id} levels={asItems(selectedProjectLevelsQuery.data)} rubros={selectedProjectRubrosQuery.data ?? []} open={taskDialogOpen} onOpenChange={setTaskDialogOpen} /> : null}
  </div>;
}
