import { useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ENABLED_TABS = ['resumen', 'niveles', 'tareas', 'checklist'];
const DISABLED_TABS = ['planos', 'documentacion', 'historial'];

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const { activeCompanyId } = useCompany();
  const canEdit = useCan('projects.edit');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);

  const initialTab = searchParams.get('tab');
  const activeTab = initialTab && ENABLED_TABS.includes(initialTab) ? initialTab : 'resumen';

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
      <div>
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
          {canEdit ? (
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              <Pencil className="h-4 w-4" /> Editar obra
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            <TabsTrigger value="niveles">Niveles</TabsTrigger>
            <TabsTrigger value="tareas">Tareas</TabsTrigger>
            <TabsTrigger value="checklist">Avance</TabsTrigger>
            {DISABLED_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} disabled className="capitalize">
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="resumen">
          <ResumenTab companyId={companyId} project={project} />
        </TabsContent>
        <TabsContent value="niveles">
          <NivelesTab companyId={companyId} projectId={project.id} />
        </TabsContent>
        <TabsContent value="tareas">
          <TareasTab companyId={companyId} projectId={project.id} />
        </TabsContent>
        <TabsContent value="checklist">
          <ChecklistTab companyId={companyId} projectId={project.id} />
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
