import { useQuery } from '@tanstack/react-query';
import { BarChart3, Building2, ClipboardCheck, ListChecks, Users, Wrench } from 'lucide-react';
import { useCompany } from '@/context/CompanyProvider';
import { reportsApi } from '@/lib/api/modules';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Building2 }) {
  return <Card><CardContent className="flex items-center gap-3 p-5"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div><div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div></CardContent></Card>;
}

export function ReportsPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const query = useQuery({ queryKey: ['reports-overview', companyId], queryFn: ({ signal }) => reportsApi.overview(companyId, signal), enabled: Boolean(companyId) });
  if (query.isLoading) return <LoadingState label="Calculando indicadores..." />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  return <div className="space-y-6"><div><h1 className="text-2xl font-semibold">Reportes</h1><p className="text-sm text-muted-foreground">Vista consolidada y en tiempo real de la constructora.</p></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-3"><Metric label="Obras" value={data.projects_total} icon={Building2} /><Metric label="Obras activas" value={data.projects_active} icon={BarChart3} /><Metric label="Tareas" value={data.tasks_total} icon={ListChecks} /><Metric label="Controles" value={data.checklist_total} icon={ClipboardCheck} /><Metric label="Inventario" value={data.inventory_total} icon={Wrench} /><Metric label="Personal activo" value={data.members_active} icon={Users} /></div><Card><CardHeader><CardTitle className="text-base">Avance consolidado</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-end justify-between"><span className="text-3xl font-semibold">{Math.round(data.completion_percent)}%</span><span className="text-sm text-muted-foreground">{data.checklist_completed}/{data.checklist_total} controles · {data.tasks_completed}/{data.tasks_total} tareas</span></div><Progress value={data.completion_percent} /></CardContent></Card></div>;
}
