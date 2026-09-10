import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { checklistApi } from '@/lib/api/checklist';
import { projectsApi } from '@/lib/api/projects';
import type { ChecklistItem, ChecklistStatus, Level, ProjectSector } from '@/types/api';
import { useCan, useCanAssigned } from '@/auth/useCan';
import { asItems } from '@/lib/collection';
import { CHECKLIST_STATUS, CHECKLIST_STATUS_OPTIONS } from '@/lib/labels';
import { formatDate } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { ChecklistFormDialog } from '@/pages/projects/ChecklistFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = 'all';

type SectorColumn = { sector: ProjectSector; levels: Level[] };

function levelProgress(items: ChecklistItem[]) {
  const applicable = items.filter((item) => item.status !== 'not_applicable');
  const completed = applicable.filter((item) => item.status === 'completed').length;
  return {
    total: applicable.length,
    completed,
    percent: applicable.length ? Math.round((completed / applicable.length) * 100) : 0,
  };
}

function workStatusLabel(level: Level): string {
  if (level.work_status === 'concreted') return 'Hormigonado';
  if (level.work_status === 'in_progress') return 'En ejecución';
  return 'Pendiente';
}

function workStatusClass(level: Level): string {
  if (level.work_status === 'concreted') return 'bg-emerald-100 text-emerald-800';
  if (level.work_status === 'in_progress') return 'bg-orange-100 text-orange-800';
  return 'bg-slate-100 text-slate-700';
}

export function ChecklistTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('checklist.edit');
  const canChangeStatus = useCanAssigned('checklist.status');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ChecklistStatus | typeof ALL>(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistItem | undefined>(undefined);
  const [dialogLevelId, setDialogLevelId] = useState<string | undefined>(undefined);

  const progressQuery = useQuery({
    queryKey: ['checklist-progress', companyId, projectId],
    queryFn: ({ signal }) => checklistApi.progress(companyId, projectId, {}, signal),
  });
  const checklistQuery = useQuery({
    queryKey: ['checklist', companyId, projectId, { limit: 200 }],
    queryFn: ({ signal }) => checklistApi.list(companyId, projectId, { limit: 200 }, signal),
  });
  const levelsQuery = useQuery({
    queryKey: ['levels', companyId, projectId],
    queryFn: ({ signal }) => projectsApi.listLevels(companyId, projectId, signal),
  });
  const sectorsQuery = useQuery({
    queryKey: ['project-sectors', companyId, projectId],
    queryFn: ({ signal }) => projectsApi.listSectors(companyId, projectId, signal),
  });
  const tasksQuery = useQuery({
    queryKey: ['tasks', companyId, projectId, { limit: 100 }],
    queryFn: ({ signal }) => projectsApi.listTasks(companyId, projectId, { limit: 100 }, signal),
  });

  const allItems = useMemo(() => asItems(checklistQuery.data), [checklistQuery.data]);
  const visibleItems = useMemo(
    () => statusFilter === ALL ? allItems : allItems.filter((item) => item.status === statusFilter),
    [allItems, statusFilter],
  );
  const levels = useMemo(
    () => [...asItems(levelsQuery.data)].sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)),
    [levelsQuery.data],
  );
  const sectors = useMemo(
    () => [...(sectorsQuery.data ?? [])].sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)),
    [sectorsQuery.data],
  );
  const sectorColumns = useMemo<SectorColumn[]>(() => {
    const byId = new Map<string, SectorColumn>();
    for (const sector of sectors) byId.set(sector.id, { sector, levels: [] });
    for (const level of levels) {
      const key = level.sector_id || `legacy:${level.building_name || 'Obra general'}`;
      let column = byId.get(key);
      if (!column) {
        column = {
          sector: { id: key, project_id: projectId, name: level.building_name || 'Obra general', sort_order: 9_999 },
          levels: [],
        };
        byId.set(key, column);
      }
      column.levels.push(level);
    }
    return Array.from(byId.values())
      .map((column) => ({ ...column, levels: [...column.levels].sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)) }))
      .sort((left, right) => left.sector.sort_order - right.sector.sort_order || left.sector.name.localeCompare(right.sector.name));
  }, [levels, projectId, sectors]);
  const allItemsByLevel = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of allItems) {
      if (!item.level_id) continue;
      map.set(item.level_id, [...(map.get(item.level_id) ?? []), item]);
    }
    return map;
  }, [allItems]);
  const visibleItemsByLevel = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of visibleItems) {
      if (!item.level_id) continue;
      map.set(item.level_id, [...(map.get(item.level_id) ?? []), item]);
    }
    return map;
  }, [visibleItems]);
  const taskNames = useMemo(
    () => new Map(asItems(tasksQuery.data).map((task) => [task.id, task.title])),
    [tasksQuery.data],
  );
  const unassignedItems = visibleItems.filter((item) => !item.level_id);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['checklist', companyId, projectId] });
    void queryClient.invalidateQueries({ queryKey: ['checklist-progress', companyId, projectId] });
    void queryClient.invalidateQueries({ queryKey: ['levels', companyId, projectId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['reports-advanced', companyId] });
  };
  const statusMutation = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: ChecklistStatus }) =>
      checklistApi.update(companyId, projectId, itemId, { status }),
    onSuccess: () => { toast.success('Estado actualizado'); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => checklistApi.delete(companyId, projectId, itemId),
    onSuccess: () => { toast.success('Control eliminado'); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const openCreate = (levelId: string) => {
    setEditing(undefined);
    setDialogLevelId(levelId);
    setDialogOpen(true);
  };
  const openEdit = (item: ChecklistItem) => {
    setEditing(item);
    setDialogLevelId(undefined);
    setDialogOpen(true);
  };
  const deleteItem = (item: ChecklistItem) => {
    if (window.confirm(`¿Eliminar el control “${item.title}”?`)) deleteMutation.mutate(item.id);
  };

  const percent = Math.round(progressQuery.data?.completion_percent ?? 0);
  const loading = checklistQuery.isLoading || levelsQuery.isLoading || sectorsQuery.isLoading;
  const error = checklistQuery.error || levelsQuery.error || sectorsQuery.error;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Avance general</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-end justify-between"><span className="text-2xl font-semibold">{percent}%</span><span className="text-sm text-muted-foreground">{progressQuery.data?.completed ?? 0}/{progressQuery.data?.total ?? 0} completados</span></div>
          <Progress value={percent} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ChecklistStatus | typeof ALL)}>
          <SelectTrigger className="w-full sm:w-[190px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Todos los estados</SelectItem>{CHECKLIST_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Cada control queda dentro de su nivel y sector.</p>
      </div>

      {loading ? <LoadingState label="Cargando avance por sectores..." /> : error ? <ErrorState error={error} onRetry={() => { void checklistQuery.refetch(); void levelsQuery.refetch(); void sectorsQuery.refetch(); }} /> : sectorColumns.length === 0 && unassignedItems.length === 0 ? (
        <EmptyState title="Sin controles" description="Crea sectores y niveles para organizar sus checklist." icon={<ClipboardCheck className="h-6 w-6" />} />
      ) : (
        <div className="space-y-5">
          {sectorColumns.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {sectorColumns.map((column) => (
                <Card key={column.sector.id} className="overflow-hidden border-slate-200 shadow-sm">
                  <CardHeader className="border-b bg-slate-50/80 py-4"><CardTitle className="flex items-center gap-2 text-base"><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Layers className="h-4 w-4" /></span>{column.sector.name}</CardTitle></CardHeader>
                  <CardContent className="space-y-3 p-3">
                    {column.levels.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Sin niveles en este sector.</p> : null}
                    {column.levels.map((level) => {
                      const levelItems = visibleItemsByLevel.get(level.id) ?? [];
                      const progress = levelProgress(allItemsByLevel.get(level.id) ?? []);
                      return (
                        <section key={level.id} className="overflow-hidden rounded-xl border bg-white">
                          <div className="flex items-start justify-between gap-2 border-b bg-slate-50/60 p-3">
                            <div className="min-w-0"><p className="truncate font-semibold">{level.name}</p><div className="mt-1 flex items-center gap-2"><span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + workStatusClass(level)}>{workStatusLabel(level)}</span><span className="text-xs text-muted-foreground">{progress.completed}/{progress.total}</span></div></div>
                            {canEdit ? <Button size="sm" variant="ghost" title="Agregar control" onClick={() => openCreate(level.id)}><Plus className="h-4 w-4" /></Button> : null}
                          </div>
                          <Progress className="h-1.5 rounded-none" value={progress.percent} />
                          <div className="divide-y">
                            {levelItems.length === 0 ? <p className="p-3 text-xs text-muted-foreground">{statusFilter === ALL ? 'Este nivel aún no tiene controles.' : 'Sin controles con este estado.'}</p> : null}
                            {levelItems.map((item) => {
                              const status = CHECKLIST_STATUS[item.status];
                              const canUpdate = canChangeStatus(item.assigned_user_id);
                              return (
                                <div key={item.id} className="flex items-center justify-between gap-2 p-3">
                                  <div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.process_stage || 'Sin etapa'}{item.due_at ? ` · ${formatDate(item.due_at)}` : ''}</p></div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    {canUpdate ? <Select value={item.status} disabled={statusMutation.isPending} onValueChange={(value) => statusMutation.mutate({ itemId: item.id, status: value as ChecklistStatus })}><SelectTrigger className="h-8 w-[112px] text-xs"><SelectValue /></SelectTrigger><SelectContent>{CHECKLIST_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select> : <Badge variant={status?.variant ?? 'muted'}>{status?.label ?? item.status}</Badge>}
                                    {canEdit ? <><Button variant="ghost" size="icon" title="Editar control" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title="Eliminar control" onClick={() => deleteItem(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button></> : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}

          {unassignedItems.length > 0 ? (
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">Controles sin nivel</CardTitle></CardHeader><CardContent className="divide-y p-0">{unassignedItems.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="truncate font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.task_id ? taskNames.get(item.task_id) || 'Tarea no disponible' : 'Sin tarea'}</p></div>{canEdit ? <div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => deleteItem(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div> : null}</div>)}</CardContent></Card>
          ) : null}
        </div>
      )}

      {canEdit ? <ChecklistFormDialog key={editing?.id ?? `new-${dialogLevelId ?? 'unassigned'}`} companyId={companyId} projectId={projectId} levelId={dialogLevelId} item={editing} open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
    </div>
  );
}
