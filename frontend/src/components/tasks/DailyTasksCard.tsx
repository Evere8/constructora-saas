import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare2, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { taskLibraryApi } from '@/lib/api/taskLibrary';
import type { DailyTaskStatus } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

export function DailyTasksCard({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['daily-tasks', companyId],
    queryFn: ({ signal }) => taskLibraryApi.listDailyTasks(companyId, {}, signal),
    refetchInterval: 60_000,
  });
  const mutation = useMutation({
    mutationFn: ({ taskId, itemId, status }: { taskId: string; itemId: string; status: DailyTaskStatus }) =>
      taskLibraryApi.updateDailyChecklist(companyId, taskId, itemId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-tasks', companyId] });
    },
    onError: () => toast.error('No se pudo actualizar la tarea diaria'),
  });
  const tasks = query.data ?? [];
  const totalControls = tasks.reduce((sum, task) => sum + task.checklist_items.length, 0);
  const completeControls = tasks.reduce(
    (sum, task) => sum + task.checklist_items.filter((item) => item.status === 'completed').length,
    0,
  );
  const percent = totalControls ? Math.round((completeControls / totalControls) * 100) : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><CheckSquare2 className="h-4 w-4" /> Mis tareas de hoy</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Las tareas predeterminadas diarias se renuevan automáticamente.</p>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link to="/tareas">Gestionar <ChevronRight className="h-4 w-4" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No tienes tareas diarias para hoy.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground"><span>Avance del día</span><span>{completeControls}/{totalControls}</span></div>
              <Progress value={percent} />
            </div>
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.id} className="rounded-md border p-3">
                  <p className={task.status === 'completed' ? 'text-sm font-medium line-through text-muted-foreground' : 'text-sm font-medium'}>{task.title}</p>
                  {task.description ? <p className="mt-1 text-xs text-muted-foreground">{task.description}</p> : null}
                  {task.checklist_items.length ? (
                    <div className="mt-2 space-y-1.5">
                      {task.checklist_items.map((item) => (
                        <label key={item.id} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={item.status === 'completed'}
                            disabled={mutation.isPending}
                            onChange={(event) => mutation.mutate({
                              taskId: task.id,
                              itemId: item.id,
                              status: event.target.checked ? 'completed' : 'pending',
                            })}
                          />
                          <span className={item.status === 'completed' ? 'line-through text-muted-foreground' : ''}>{item.title}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
