import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock3, MapPin } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { projectsApi } from '@/lib/api/projects';
import { TASK_PRIORITY, TASK_STATUS } from '@/lib/labels';
import { asItems } from '@/lib/collection';
import type { Task } from '@/types/api';

function scheduleValue(task: Task): string | null {
  return task.planned_start_at || task.due_at || null;
}

function dateHeading(key: string): string {
  if (key === 'unscheduled') return 'Sin fecha planificada';
  return new Intl.DateTimeFormat('es-PY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${key}T12:00:00`));
}

function dateTime(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-PY', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function CronogramaTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const query = useQuery({
    queryKey: ['tasks', companyId, projectId, { limit: 100 }],
    queryFn: ({ signal }) => projectsApi.listTasks(companyId, projectId, { limit: 100 }, signal),
  });
  const groups = useMemo(() => {
    const ordered = [...asItems(query.data)].sort((left, right) => {
      const leftValue = scheduleValue(left);
      const rightValue = scheduleValue(right);
      if (!leftValue) return 1;
      if (!rightValue) return -1;
      return leftValue.localeCompare(rightValue);
    });
    const grouped = new Map<string, Task[]>();
    for (const task of ordered) {
      const key = scheduleValue(task)?.slice(0, 10) ?? 'unscheduled';
      const day = grouped.get(key);
      if (day) day.push(task);
      else grouped.set(key, [task]);
    }
    return Array.from(grouped.entries());
  }, [query.data]);

  if (query.isLoading) return <LoadingState label="Organizando cronograma..." />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (groups.length === 0) return <EmptyState title="Sin tareas planificadas" description="Crea tareas con inicio y fecha límite para construir el cronograma." icon={<CalendarDays className="h-6 w-6" />} />;

  return (
    <div className="space-y-6">
      {groups.map(([day, tasks]) => (
        <section key={day} className="space-y-2">
          <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold capitalize">{dateHeading(day)}</h3><Badge variant="muted">{tasks.length}</Badge></div>
          <div className="grid gap-2 md:grid-cols-2">
            {tasks.map((task) => {
              const status = TASK_STATUS[task.status];
              const priority = TASK_PRIORITY[task.priority];
              const overdue = Boolean(task.due_at && new Date(task.due_at) < new Date() && !['completed', 'cancelled'].includes(task.status));
              return (
                <Card key={task.id} className={overdue ? 'border-destructive/40' : undefined}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{task.title}</p>{task.location_text ? <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {task.location_text}</p> : null}</div><Badge variant={status?.variant ?? 'muted'}>{status?.label ?? task.status}</Badge></div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {dateTime(task.planned_start_at)} → {dateTime(task.due_at)}</span><Badge variant={priority?.variant ?? 'muted'}>{priority?.label ?? task.priority}</Badge>{overdue ? <Badge variant="destructive">Atrasada</Badge> : null}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
