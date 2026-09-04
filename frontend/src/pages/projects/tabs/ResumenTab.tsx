import { useQuery } from '@tanstack/react-query';
import { checklistApi } from '@/lib/api/checklist';
import { projectsApi } from '@/lib/api/projects';
import { asItems, asTotal } from '@/lib/collection';
import type { Project } from '@/types/api';
import { PROJECT_STATUS } from '@/lib/labels';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

export function ResumenTab({ companyId, project }: { companyId: string; project: Project }) {
  const progressQuery = useQuery({
    queryKey: ['checklist-progress', companyId, project.id],
    queryFn: ({ signal }) => checklistApi.progress(companyId, project.id, {}, signal),
  });

  const levelsQuery = useQuery({
    queryKey: ['levels', companyId, project.id],
    queryFn: ({ signal }) => projectsApi.listLevels(companyId, project.id, signal),
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks', companyId, project.id, { limit: 1 }],
    queryFn: ({ signal }) => projectsApi.listTasks(companyId, project.id, { limit: 1 }, signal),
  });

  const status = PROJECT_STATUS[project.status];
  const percent = Math.round(progressQuery.data?.completion_percent ?? 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Informacion de la obra</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Fact label="Codigo" value={project.code || '\u2014'} />
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Estado</dt>
              <dd className="mt-1">
                <Badge variant={status?.variant ?? 'muted'}>{status?.label ?? project.status}</Badge>
              </dd>
            </div>
            <Fact label="Inicio" value={formatDate(project.start_date)} />
            <Fact label="Fin previsto" value={formatDate(project.planned_end_date)} />
            <Fact label="Direccion" value={project.address || '\u2014'} />
          </dl>
          {project.description ? (
            <div className="mt-4">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Descripcion</dt>
              <p className="mt-1 text-sm">{project.description}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Avance de checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-semibold">{percent}%</span>
              <span className="text-sm text-muted-foreground">
                {progressQuery.data?.completed ?? 0}/{progressQuery.data?.total ?? 0} completados
              </span>
            </div>
            <Progress value={percent} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Niveles</p>
              <p className="mt-1 text-2xl font-semibold">{asItems(levelsQuery.data).length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Tareas</p>
              <p className="mt-1 text-2xl font-semibold">{asTotal(tasksQuery.data)}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
