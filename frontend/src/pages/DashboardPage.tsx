import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Building2,
  FileSpreadsheet,
  Map,
  Users,
  Wrench,
  ArrowRight,
  CalendarClock,
} from 'lucide-react';
import { projectsApi } from '@/lib/api/projects';
import { useCompany } from '@/context/CompanyProvider';
import { useMe } from '@/auth/useMe';
import { roleLabel } from '@/auth/permissions';
import { asItems } from '@/lib/collection';
import { PROJECT_STATUS } from '@/lib/labels';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const BANNER = 'https://images.pexels.com/photos/18078304/pexels-photo-18078304.jpeg?auto=compress&cs=tinysrgb&w=1400';
const QUICK_ACTIONS = [
  { label: 'Obras y tareas', icon: Building2, to: '/obras', soon: false },
  { label: 'Planos por obra', icon: Map, to: '#', soon: true },
  { label: 'PDF a Excel', icon: FileSpreadsheet, to: '#', soon: true },
  { label: 'Herramientas', icon: Wrench, to: '/inventario', soon: true },
  { label: 'Personal', icon: Users, to: '/personal', soon: true },
] as const;

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { activeCompanyId, activeMembership } = useCompany();
  const { data: me } = useMe();

  const query = useQuery({
    queryKey: ['projects', activeCompanyId, { limit: 100 }],
    queryFn: ({ signal }) => projectsApi.list(activeCompanyId as string, { limit: 100 }, signal),
    enabled: Boolean(activeCompanyId),
  });

  const projects = asItems(query.data);
  const stats = {
    total: query.data?.total ?? projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    inactive: projects.filter((p) => p.status === 'inactive').length,
  };
  const recent = projects.slice(0, 5);
  const greetingName = me?.full_name || me?.name || me?.email || 'de nuevo';

  if (!activeCompanyId) {
    return (
      <EmptyState
        title="Sin constructora activa"
        description="No tienes una constructora activa asignada. Contacta al administrador de tu empresa."
        icon={<Building2 className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl bg-secondary text-white">
        <img src={BANNER} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="relative z-10 flex flex-col gap-1 p-6 sm:p-8">
          <p className="text-sm text-white/70">Hola, {greetingName}</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">{activeMembership?.company_name ?? 'Tu constructora'}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-white/80">
            <Badge variant="warning">{roleLabel(activeMembership?.role)}</Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Obras totales" value={stats.total} />
        <StatCard label="Activas" value={stats.active} />
        <StatCard label="Completadas" value={stats.completed} />
        <StatCard label="Inactivas" value={stats.inactive} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Accesos rapidos
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK_ACTIONS.map((action) =>
            action.soon ? (
              <button
                type="button"
                key={action.label}
                onClick={() => toast.info('Proximamente: este modulo se habilitara en la siguiente fase.')}
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <action.icon className="h-6 w-6" />
                <span>{action.label}</span>
                <Badge variant="warning" className="text-[10px]">Pronto</Badge>
              </button>
            ) : (
              <Link
                key={action.label}
                to={action.to}
                className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center text-sm font-medium transition-colors hover:border-primary hover:text-primary"
              >
                <action.icon className="h-6 w-6 text-primary" />
                <span>{action.label}</span>
              </Link>
            ),
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Obras recientes</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/obras">
              Ver todas <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : recent.length === 0 ? (
            <EmptyState title="Aun no hay obras" description="Crea tu primera obra para comenzar." />
          ) : (
            <ul className="divide-y">
              {recent.map((project) => {
                const status = PROJECT_STATUS[project.status];
                return (
                  <li key={project.id}>
                    <Link
                      to={`/obras/${project.id}`}
                      className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-primary"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{project.name}</p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="h-3 w-3" />
                          {project.code || 'Sin codigo'}
                        </p>
                      </div>
                      <Badge variant={status?.variant ?? 'muted'}>{status?.label ?? project.status}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
