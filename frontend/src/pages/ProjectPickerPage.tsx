import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight } from 'lucide-react';
import { projectsApi } from '@/lib/api/projects';
import { useCompany } from '@/context/CompanyProvider';
import { asItems } from '@/lib/collection';
import { PROJECT_STATUS } from '@/lib/labels';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export function ProjectPickerPage({ title, tab }: { title: string; tab: 'tareas' | 'checklist' }) {
  const { activeCompanyId } = useCompany();

  const query = useQuery({
    queryKey: ['projects', activeCompanyId, { limit: 100 }],
    queryFn: ({ signal }) => projectsApi.list(activeCompanyId as string, { limit: 100 }, signal),
    enabled: Boolean(activeCompanyId),
  });

  const projects = asItems(query.data);

  if (!activeCompanyId) {
    return (
      <EmptyState
        title="Sin constructora activa"
        description="Selecciona una constructora para continuar."
        icon={<Building2 className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={`Elige una obra para ver su ${title.toLowerCase()}.`} />

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : projects.length === 0 ? (
        <EmptyState title="Sin obras" description="Crea una obra primero desde la seccion Obras." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((project) => {
            const status = PROJECT_STATUS[project.status];
            return (
              <Link key={project.id} to={`/obras/${project.id}?tab=${tab}`}>
                <Card className="transition-colors hover:border-primary">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{project.name}</p>
                      <p className="text-xs text-muted-foreground">{project.code || 'Sin codigo'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={status?.variant ?? 'muted'}>{status?.label ?? project.status}</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
