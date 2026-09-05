import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, Check, ChevronRight, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCompany } from '@/context/CompanyProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { notificationsApi } from '@/lib/api/modules';
import { formatDate } from '@/lib/utils';
import type { OperationalNotification } from '@/types/api';

const SEVERITY = {
  info: { label: 'Próximo', variant: 'muted' as const },
  warning: { label: 'Atención', variant: 'warning' as const },
  critical: { label: 'Urgente', variant: 'destructive' as const },
};

function useNotifications() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const query = useQuery({
    queryKey: ['notifications', companyId],
    queryFn: ({ signal }) => notificationsApi.list(companyId, signal),
    enabled: Boolean(companyId),
    refetchInterval: 60_000,
  });
  return { companyId, query };
}

function AlertText({ item }: { item: OperationalNotification }) {
  const severity = SEVERITY[item.severity];
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className={item.status === 'unread' ? 'text-sm font-semibold' : 'text-sm font-medium'}>{item.title}</p>
        <Badge variant={severity.variant} className="text-[10px]">{severity.label}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
      {item.due_at ? <p className="mt-1 text-[11px] text-muted-foreground">Fecha: {formatDate(item.due_at)}</p> : null}
    </div>
  );
}

export function NotificationCenter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { companyId, query } = useNotifications();
  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'read' | 'dismissed' }) =>
      notificationsApi.update(companyId, id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] }),
  });
  const data = query.data;
  const items = data?.items.slice(0, 8) ?? [];

  const openAlert = (item: OperationalNotification) => {
    if (item.status === 'unread') mutation.mutate({ id: item.id, status: 'read' });
    if (item.project_id) navigate(`/obras/${item.project_id}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Abrir alertas${data?.unread_count ? `, ${data.unread_count} sin leer` : ''}`}
          className="relative flex h-9 w-9 items-center justify-center rounded-full border bg-background outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-4 w-4" />
          {data?.unread_count ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-5 text-destructive-foreground">{Math.min(data.unread_count, 99)}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <DropdownMenuLabel className="flex items-center justify-between px-4 py-3">
          <span>Alertas operativas</span>
          <Badge variant="outline">{data?.unread_count ?? 0} nuevas</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="m-0" />
        {query.isLoading ? <p className="p-4 text-sm text-muted-foreground">Comprobando vencimientos...</p> : query.isError ? <p className="p-4 text-sm text-destructive">No se pudieron actualizar las alertas.</p> : items.length === 0 ? <div className="p-6 text-center"><Check className="mx-auto h-6 w-6 text-emerald-600" /><p className="mt-2 text-sm font-medium">Todo al día</p><p className="text-xs text-muted-foreground">No hay faltantes ni vencimientos próximos.</p></div> : <div className="max-h-[28rem] divide-y overflow-y-auto">{items.map((item) => <div key={item.id} className="flex gap-2 p-3"><button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => openAlert(item)}><AlertTriangle className={item.severity === 'critical' ? 'mt-0.5 h-4 w-4 shrink-0 text-destructive' : 'mt-0.5 h-4 w-4 shrink-0 text-amber-600'} /><AlertText item={item} /><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></button><Button type="button" variant="ghost" size="icon" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: item.id, status: 'dismissed' })}><X className="h-4 w-4" /><span className="sr-only">Descartar alerta</span></Button></div>)}</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AlertsSummaryCard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { companyId, query } = useNotifications();
  const mutation = useMutation({
    mutationFn: (item: OperationalNotification) => notificationsApi.update(companyId, item.id, 'read'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] }),
  });
  const items = query.data?.items.slice(0, 4) ?? [];
  const openAlert = (item: OperationalNotification) => {
    if (item.status === 'unread') mutation.mutate(item);
    if (item.project_id) navigate(`/obras/${item.project_id}`);
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-primary" /> Alertas operativas</CardTitle>
        <Badge variant={query.data?.unread_count ? 'warning' : 'outline'}>{query.data?.unread_count ?? 0} nuevas</Badge>
      </CardHeader>
      <CardContent>
        {query.isLoading ? <p className="text-sm text-muted-foreground">Comprobando riesgos...</p> : query.isError ? <p className="text-sm text-destructive">No se pudieron comprobar los riesgos.</p> : items.length === 0 ? <p className="text-sm text-muted-foreground">No hay vencimientos ni recursos pendientes para las próximas 48 horas.</p> : <div className="divide-y">{items.map((item) => <button key={item.id} type="button" className="flex w-full items-start gap-3 py-3 text-left" onClick={() => openAlert(item)}><AlertTriangle className={item.severity === 'critical' ? 'mt-0.5 h-4 w-4 text-destructive' : 'mt-0.5 h-4 w-4 text-amber-600'} /><AlertText item={item} /><ChevronRight className="mt-1 h-4 w-4 text-muted-foreground" /></button>)}</div>}
      </CardContent>
    </Card>
  );
}
