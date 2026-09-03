import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Pencil, Plus } from 'lucide-react';
import { projectsApi } from '@/lib/api/projects';
import type { Level } from '@/types/api';
import { useCan } from '@/auth/useCan';
import { asItems } from '@/lib/collection';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { LevelFormDialog } from '@/pages/projects/LevelFormDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function NivelesTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('levels.edit');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Level | undefined>(undefined);

  const query = useQuery({
    queryKey: ['levels', companyId, projectId],
    queryFn: ({ signal }) => projectsApi.listLevels(companyId, projectId, signal),
  });

  const levels = [...asItems(query.data)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (level: Level) => {
    setEditing(level);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Niveles de la obra
        </h3>
        {canEdit ? (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nuevo nivel
          </Button>
        ) : null}
      </div>

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : levels.length === 0 ? (
        <EmptyState
          title="Sin niveles"
          description="Agrega niveles (plantas, sotanos, etc.) para organizar el trabajo."
          icon={<Layers className="h-6 w-6" />}
          action={
            canEdit ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Nuevo nivel
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {levels.map((level) => (
            <Card key={level.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary">
                    {level.order ?? '-'}
                  </div>
                  <div>
                    <p className="font-medium">{level.name}</p>
                    {level.description ? (
                      <p className="text-xs text-muted-foreground">{level.description}</p>
                    ) : null}
                  </div>
                </div>
                {canEdit ? (
                  <Button variant="ghost" size="icon" onClick={() => openEdit(level)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {canEdit ? (
        <LevelFormDialog
          key={editing?.id ?? 'new'}
          companyId={companyId}
          projectId={projectId}
          level={editing}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </div>
  );
}
