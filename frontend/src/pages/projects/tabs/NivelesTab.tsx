import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectsApi } from '@/lib/api/projects';
import type { Level, ProjectSector } from '@/types/api';
import { useCan } from '@/auth/useCan';
import { asItems } from '@/lib/collection';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { LevelFormDialog } from '@/pages/projects/LevelFormDialog';
import { SectorFormDialog } from '@/pages/projects/SectorFormDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type SectorColumn = { sector: ProjectSector; levels: Level[] };

const STATUS_STYLE = {
  pending: 'bg-slate-400',
  in_progress: 'bg-orange-500',
  concreted: 'bg-emerald-500',
} as const;

function sortedLevels(levels: Level[]): Level[] {
  return [...levels].sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

export function NivelesTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('levels.edit');
  const queryClient = useQueryClient();
  const [levelDialogOpen, setLevelDialogOpen] = useState(false);
  const [sectorDialogOpen, setSectorDialogOpen] = useState(false);
  const [editingLevel, setEditingLevel] = useState<Level | undefined>(undefined);
  const [editingSector, setEditingSector] = useState<ProjectSector | undefined>(undefined);
  const [defaultSectorId, setDefaultSectorId] = useState<string | undefined>(undefined);

  const levelsQuery = useQuery({
    queryKey: ['levels', companyId, projectId],
    queryFn: ({ signal }) => projectsApi.listLevels(companyId, projectId, signal),
  });
  const sectorsQuery = useQuery({
    queryKey: ['project-sectors', companyId, projectId],
    queryFn: ({ signal }) => projectsApi.listSectors(companyId, projectId, signal),
  });

  const sectors = useMemo(
    () => [...(sectorsQuery.data ?? [])].sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)),
    [sectorsQuery.data],
  );
  const levels = useMemo(() => sortedLevels(asItems(levelsQuery.data)), [levelsQuery.data]);
  const columns = useMemo<SectorColumn[]>(() => {
    const byId = new Map<string, SectorColumn>();
    for (const sector of sectors) byId.set(sector.id, { sector, levels: [] });
    for (const level of levels) {
      const sectorId = level.sector_id;
      let column = sectorId ? byId.get(sectorId) : undefined;
      // This fallback keeps legacy rows visible until the migration has run.
      if (!column) {
        const name = level.building_name?.trim() || 'Obra general';
        const legacyId = sectorId || `legacy:${name}`;
        column = byId.get(legacyId);
        if (!column) {
          column = { sector: { id: legacyId, project_id: projectId, name, sort_order: 9_999 }, levels: [] };
          byId.set(legacyId, column);
        }
      }
      column.levels.push(level);
    }
    return Array.from(byId.values())
      .map((column) => ({ ...column, levels: sortedLevels(column.levels) }))
      .sort((left, right) => left.sector.sort_order - right.sector.sort_order || left.sector.name.localeCompare(right.sector.name));
  }, [levels, projectId, sectors]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['project-sectors', companyId, projectId] });
    void queryClient.invalidateQueries({ queryKey: ['levels', companyId, projectId] });
    void queryClient.invalidateQueries({ queryKey: ['checklist', companyId, projectId] });
    void queryClient.invalidateQueries({ queryKey: ['checklist-progress', companyId, projectId] });
  };
  const deleteLevelMutation = useMutation({
    mutationFn: (levelId: string) => projectsApi.deleteLevel(companyId, projectId, levelId),
    onSuccess: () => { toast.success('Nivel eliminado'); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteSectorMutation = useMutation({
    mutationFn: (sectorId: string) => projectsApi.deleteSector(companyId, projectId, sectorId),
    onSuccess: () => { toast.success('Sector eliminado'); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const openCreateSector = () => {
    setEditingSector(undefined);
    setSectorDialogOpen(true);
  };
  const openEditSector = (sector: ProjectSector) => {
    setEditingSector(sector);
    setSectorDialogOpen(true);
  };
  const openCreateLevel = (sectorId?: string) => {
    if (!sectorId && sectors.length === 0) {
      toast.info('Crea primero un sector para cargar sus niveles.');
      return;
    }
    setEditingLevel(undefined);
    setDefaultSectorId(sectorId ?? sectors[0]?.id);
    setLevelDialogOpen(true);
  };
  const openEditLevel = (level: Level) => {
    setEditingLevel(level);
    setDefaultSectorId(level.sector_id);
    setLevelDialogOpen(true);
  };
  const confirmDeleteLevel = (level: Level) => {
    if (window.confirm(`¿Eliminar ${level.name} de ${level.building_name || 'este sector'}?`)) {
      deleteLevelMutation.mutate(level.id);
    }
  };
  const confirmDeleteSector = (column: SectorColumn) => {
    if (column.levels.length > 0) {
      toast.error('Elimina o mueve primero los niveles de este sector.');
      return;
    }
    if (window.confirm(`¿Eliminar el sector ${column.sector.name}?`)) {
      deleteSectorMutation.mutate(column.sector.id);
    }
  };

  if (levelsQuery.isLoading || sectorsQuery.isLoading) return <LoadingState />;
  if (levelsQuery.isError) return <ErrorState error={levelsQuery.error} onRetry={() => void levelsQuery.refetch()} />;
  if (sectorsQuery.isError) return <ErrorState error={sectorsQuery.error} onRetry={() => void sectorsQuery.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Niveles de la obra</h3>
          <p className="mt-1 text-sm text-muted-foreground">Cada sector es independiente: puedes repetir el mismo nivel en otra columna.</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={openCreateSector}><Building2 className="h-4 w-4" /> Nuevo sector</Button>
            <Button size="sm" onClick={() => openCreateLevel()} disabled={sectors.length === 0}><Plus className="h-4 w-4" /> Nuevo nivel</Button>
          </div>
        ) : null}
      </div>

      {columns.length === 0 ? (
        <EmptyState
          title="Sin sectores"
          description="Crea el primer sector y luego carga sus losas o niveles dentro de esa columna."
          icon={<Building2 className="h-6 w-6" />}
          action={canEdit ? <Button size="sm" onClick={openCreateSector}><Plus className="h-4 w-4" /> Nuevo sector</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {columns.map((column) => {
            const liveSector = sectors.find((sector) => sector.id === column.sector.id);
            return (
              <Card key={column.sector.id} className="overflow-hidden border-slate-200 shadow-sm">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between gap-3 border-b bg-slate-50/80 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></div>
                      <div className="min-w-0"><p className="truncate font-semibold">{column.sector.name}</p><p className="text-xs text-muted-foreground">{column.levels.length} nivel{column.levels.length === 1 ? '' : 'es'}</p></div>
                    </div>
                    {canEdit && liveSector ? (
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" title="Editar sector" onClick={() => openEditSector(liveSector)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" title="Eliminar sector" onClick={() => confirmDeleteSector(column)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-2 p-3">
                    {column.levels.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Aún no hay niveles en este sector.</p> : null}
                    {column.levels.map((level) => (
                      <div key={level.id} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-3 shadow-sm">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-50 text-primary"><Layers className="h-4 w-4" /></div>
                          <div className="min-w-0"><p className="truncate font-medium">{level.name}</p><span className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={'h-2 w-2 rounded-full ' + STATUS_STYLE[level.work_status]} />{level.work_status === 'concreted' ? 'Hormigonado' : level.work_status === 'in_progress' ? 'En ejecución' : 'Pendiente'}</span></div>
                        </div>
                        {canEdit ? <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" title="Editar nivel" onClick={() => openEditLevel(level)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title="Eliminar nivel" onClick={() => confirmDeleteLevel(level)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div> : null}
                      </div>
                    ))}
                    {canEdit && liveSector ? <Button className="w-full" size="sm" variant="outline" onClick={() => openCreateLevel(liveSector.id)}><Plus className="h-4 w-4" /> Agregar nivel</Button> : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {canEdit ? (
        <>
          <SectorFormDialog key={editingSector?.id ?? 'new-sector'} companyId={companyId} projectId={projectId} sector={editingSector} open={sectorDialogOpen} onOpenChange={setSectorDialogOpen} />
          <LevelFormDialog key={editingLevel?.id ?? `new-level-${defaultSectorId ?? 'none'}`} companyId={companyId} projectId={projectId} level={editingLevel} sectors={sectors} defaultSectorId={defaultSectorId} open={levelDialogOpen} onOpenChange={setLevelDialogOpen} />
        </>
      ) : null}
    </div>
  );
}
