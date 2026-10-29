import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { projectsApi } from '@/lib/api/projects';
import type { Project } from '@/types/api';
import { useCompany } from '@/context/CompanyProvider';
import { useCan } from '@/auth/useCan';
import { PROJECT_STATUS } from '@/lib/labels';
import { ErrorState, FullScreenLoader } from '@/components/common/states';
import { ResumenTab } from '@/pages/projects/tabs/ResumenTab';
import { NivelesTab } from '@/pages/projects/tabs/NivelesTab';
import { TareasTab } from '@/pages/projects/tabs/TareasTab';
import { ChecklistTab } from '@/pages/projects/tabs/ChecklistTab';
import { ProjectFormDialog } from '@/pages/projects/ProjectFormDialog';
import { ProjectStatusAction } from '@/pages/projects/ProjectStatusAction';
import { ProjectArchiveStatus } from '@/pages/projects/ProjectArchiveStatus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ENABLED_TABS = ['resumen', 'rubros', 'niveles', 'cronograma', 'tareas', 'checklist', 'planos'];
const PlanosTab = lazy(() => import('@/pages/projects/tabs/PlanosTab').then((module) => ({ default: module.PlanosTab })));
const RubrosTab = lazy(() => import('@/pages/projects/tabs/RubrosTab').then((module) => ({ default: module.RubrosTab })));
const CronogramaTab = lazy(() => import('@/pages/projects/tabs/CronogramaTab').then((module) => ({ default: module.CronogramaTab })));

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const { activeCompanyId } = useCompany();
  const canEdit = useCan('projects.edit');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);

  const initialTab = searchParams.get('tab');
  const activeTab = initialTab === 'documentacion'
    ? 'rubros'
    : initialTab && ENABLED_TABS.includes(initialTab) ? initialTab : 'resumen';

  const query = useQuery({
    queryKey: ['project', activeCompanyId, projectId],
    queryFn: ({ signal }) => projectsApi.get(activeCompanyId as string, projectId, signal),
    enabled: Boolean(activeCompanyId && projectId),
  });

  if (query.isLoading) return <FullScreenLoader label="Cargando obra..." />;
  if (query.isError || !query.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/obras')}>
          <ArrowLeft className="h-4 w-4" /> Volver a obras
        </Button>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const project = query.data as Project;
  const companyId = activeCompanyId as string;
  const status = PROJECT_STATUS[project.status];

  const setTab = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <div className="space-y-6">
      <div className="surface-solid rounded-2xl border p-4 sm:p-5">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/obras">
            <ArrowLeft className="h-4 w-4" /> Obras
          </Link>
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <Badge variant={status?.variant ?? 'muted'}>{status?.label ?? project.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{project.code || 'Sin codigo'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusAction project={project} />
            {canEdit ? (
              <Button variant="outline" onClick={() => setDialogOpen(true)}>
                <Pencil className="h-4 w-4" /> Editar obra
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {project.status === 'inactive' ? <ProjectArchiveStatus companyId={companyId} projectId={projectId} /> : null}
      <Tabs value={activeTab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList className="bubble-nav h-auto w-max gap-1.5 bg-card/80">
            <TabsTrigger className="rounded-xl px-3.5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="resumen">Resumen</TabsTrigger>
            <TabsTrigger className="rounded-xl px-3.5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="rubros">Rubros</TabsTrigger>
            <TabsTrigger className="rounded-xl px-3.5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="niveles">Niveles</TabsTrigger>
            <TabsTrigger className="rounded-xl px-3.5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="cronograma">Cronograma</TabsTrigger>
            <TabsTrigger className="rounded-xl px-3.5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="tareas">Tareas</TabsTrigger>
            <TabsTrigger className="rounded-xl px-3.5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="checklist">Avance</TabsTrigger>
            <TabsTrigger className="rounded-xl px-3.5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="planos">Planos</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="resumen">
          <ResumenTab companyId={companyId} project={project} />
        </TabsContent>
        <TabsContent value="rubros">
          <Suspense fallback={<FullScreenLoader label="Cargando rubros..." />}>
            <RubrosTab companyId={companyId} projectId={project.id} />
          </Suspense>
        </TabsContent>
        <TabsContent value="niveles">
          <NivelesTab companyId={companyId} projectId={project.id} />
        </TabsContent>
        <TabsContent value="cronograma">
          <Suspense fallback={<FullScreenLoader label="Cargando cronograma..." />}>
            <CronogramaTab companyId={companyId} projectId={project.id} />
          </Suspense>
        </TabsContent>
        <TabsContent value="tareas">
          <TareasTab companyId={companyId} projectId={project.id} />
        </TabsContent>
        <TabsContent value="checklist">
          <ChecklistTab companyId={companyId} projectId={project.id} />
        </TabsContent>
        <TabsContent value="planos">
          <Suspense fallback={<FullScreenLoader label="Cargando planos..." />}>
            <PlanosTab
              companyId={companyId}
              projectId={project.id}
              overviewPlanVersionId={project.overview_plan_version_id ?? null}
            />
          </Suspense>
        </TabsContent>
      </Tabs>

      {canEdit ? (
        <ProjectFormDialog
          key={project.id}
          companyId={companyId}
          project={project}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </div>
  );
}
