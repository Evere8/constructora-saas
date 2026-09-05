import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Download,
  ListChecks,
  UserRoundX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '@/context/CompanyProvider';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { membersApi, reportsApi, saveBlob } from '@/lib/api/modules';
import { projectsApi } from '@/lib/api/projects';
import { asItems } from '@/lib/collection';
import type { QueryParams } from '@/lib/http';

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function Metric({
  label,
  value,
  icon: Icon,
  danger = false,
}: {
  label: string;
  value: number;
  icon: typeof Building2;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={danger ? 'rounded-lg bg-destructive/10 p-2 text-destructive' : 'rounded-lg bg-primary/10 p-2 text-primary'}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressRow({
  name,
  completed,
  total,
  overdue,
  percent,
}: {
  name: string;
  completed: number;
  total: number;
  overdue: number;
  percent: number;
}) {
  return (
    <div className="space-y-2 border-b py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{completed}/{total} tareas completadas</p>
        </div>
        <div className="flex items-center gap-2">
          {overdue ? <Badge variant="destructive">{overdue} vencida(s)</Badge> : null}
          <span className="w-12 text-right text-sm font-semibold">{Math.round(percent)}%</span>
        </div>
      </div>
      <Progress value={percent} />
    </div>
  );
}

export function ReportsPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [projectId, setProjectId] = useState('all');
  const [assigneeId, setAssigneeId] = useState('all');

  const filters = useMemo<QueryParams>(() => ({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    project_id: projectId === 'all' ? undefined : projectId,
    assigned_user_id: assigneeId === 'all' ? undefined : assigneeId,
  }), [assigneeId, dateFrom, dateTo, projectId]);

  const reportQuery = useQuery({
    queryKey: ['reports-advanced', companyId, filters],
    queryFn: ({ signal }) => reportsApi.advanced(companyId, filters, signal),
    enabled: Boolean(companyId),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', companyId, { limit: 100 }],
    queryFn: ({ signal }) => projectsApi.list(companyId, { limit: 100 }, signal),
    enabled: Boolean(companyId),
  });
  const membersQuery = useQuery({
    queryKey: ['company-members', companyId],
    queryFn: ({ signal }) => membersApi.list(companyId, signal),
    enabled: Boolean(companyId),
  });
  const exportMutation = useMutation({
    mutationFn: () => reportsApi.csv(companyId, filters),
    onSuccess: (blob) => saveBlob(blob, `reporte-obrixapy-${dateTo || 'completo'}.csv`),
    onError: () => toast.error('No se pudo exportar el reporte'),
  });

  const applyPreset = (preset: 'today' | 'week' | 'month' | 'all') => {
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const today = new Date();
    const start = new Date(today);
    if (preset === 'week') start.setDate(today.getDate() - 6);
    if (preset === 'month') start.setDate(1);
    setDateFrom(localDate(start));
    setDateTo(localDate(today));
  };

  if (reportQuery.isLoading) return <LoadingState label="Calculando indicadores..." />;
  if (reportQuery.isError || !reportQuery.data) return <ErrorState error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />;
  const data = reportQuery.data;
  const projects = asItems(projectsQuery.data);
  const members = membersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reportes avanzados</h1>
          <p className="text-sm text-muted-foreground">Analiza avance, atrasos, responsables y faltantes por período.</p>
        </div>
        <Button variant="outline" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
          <Download className="h-4 w-4" /> {exportMutation.isPending ? 'Exportando...' : 'Descargar CSV'}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => applyPreset('today')}>Hoy</Button>
            <Button size="sm" variant="outline" onClick={() => applyPreset('week')}>7 días</Button>
            <Button size="sm" variant="outline" onClick={() => applyPreset('month')}>Este mes</Button>
            <Button size="sm" variant="ghost" onClick={() => applyPreset('all')}>Todo</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1"><Label htmlFor="report-from">Desde</Label><Input id="report-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="report-to">Hasta</Label><Input id="report-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></div>
            <div className="space-y-1"><Label>Obra</Label><Select value={projectId} onValueChange={setProjectId}><SelectTrigger aria-label="Filtrar por obra"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas las obras</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Responsable</Label><Select value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger aria-label="Filtrar por responsable"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem>{members.map((member) => <SelectItem key={member.user_id} value={member.user_id}>{member.full_name || member.email}</SelectItem>)}</SelectContent></Select></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Tareas" value={data.tasks_total} icon={ListChecks} />
        <Metric label="Completadas" value={data.tasks_completed} icon={CheckCircle2} />
        <Metric label="Vencidas" value={data.tasks_overdue} icon={AlertTriangle} danger={data.tasks_overdue > 0} />
        <Metric label="Próximas 48 h" value={data.tasks_due_soon} icon={CalendarClock} />
        <Metric label="Sin responsable" value={data.tasks_unassigned} icon={UserRoundX} danger={data.tasks_unassigned > 0} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Avance del período</CardTitle><span className="text-3xl font-semibold">{Math.round(data.completion_percent)}%</span></CardHeader>
        <CardContent className="space-y-3"><Progress value={data.completion_percent} /><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-muted-foreground">Controles</p><p className="font-semibold">{data.checklist_completed}/{data.checklist_total}</p></div><div><p className="text-muted-foreground">Bloqueados</p><p className="font-semibold">{data.checklist_blocked}</p></div><div><p className="text-muted-foreground">Recursos en riesgo</p><p className="font-semibold">{data.requirements_at_risk}</p></div><div><p className="text-muted-foreground">Tareas completadas</p><p className="font-semibold">{data.tasks_completed}/{data.tasks_total}</p></div></div></CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Avance por obra</CardTitle></CardHeader><CardContent>{data.projects.length ? data.projects.map((row) => <ProgressRow key={row.project_id} name={row.project_name} completed={row.tasks_completed} total={row.tasks_total} overdue={row.tasks_overdue} percent={row.completion_percent} />) : <p className="text-sm text-muted-foreground">No hay tareas para los filtros elegidos.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Avance por responsable</CardTitle></CardHeader><CardContent>{data.assignees.length ? data.assignees.map((row) => <ProgressRow key={row.user_id ?? 'unassigned'} name={row.name} completed={row.tasks_completed} total={row.tasks_total} overdue={row.tasks_overdue} percent={row.completion_percent} />) : <p className="text-sm text-muted-foreground">No hay responsables para los filtros elegidos.</p>}</CardContent></Card>
      </div>
    </div>
  );
}
