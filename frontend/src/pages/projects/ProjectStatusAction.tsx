import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCompany } from '@/context/CompanyProvider';
import { projectsApi } from '@/lib/api/projects';
import type { Project } from '@/types/api';

export function ProjectStatusAction({ project }: { project: Project }) {
  const { activeCompanyId, activeMembership } = useCompany();
  const queryClient = useQueryClient();
  const administrator = activeMembership?.role === 'owner' || activeMembership?.role === 'admin';
  const inactive = project.status === 'inactive';
  const [archiving, setArchiving] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      if (inactive) return projectsApi.reactivate(activeCompanyId as string, project.id);
      const result = await projectsApi.deactivate(activeCompanyId as string, project.id);
      setArchiving(true);
      try {
        while (!(await projectsApi.archiveStep(activeCompanyId as string, project.id)).complete) { /* one verified object per request */ }
      } catch (error) {
        toast.error(`Obra inactiva; archivado pendiente. Puedes reintentarlo dentro de la obra. ${error instanceof Error ? error.message : ''}`);
      } finally { setArchiving(false); }
      return result;
    },
    onSuccess: () => {
      toast.success(inactive ? 'Obra reactivada' : 'Obra marcada como inactiva');
      void queryClient.invalidateQueries({ queryKey: ['projects', activeCompanyId] });
      void queryClient.invalidateQueries({ queryKey: ['project', activeCompanyId, project.id] });
      void queryClient.invalidateQueries({ queryKey: ['archive-status', activeCompanyId, project.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!administrator || !['active', 'inactive'].includes(project.status)) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => {
        if (inactive || window.confirm(`¿Marcar «${project.name}» como inactiva? Los archivos se conservarán y podrás reactivarla.`)) {
          mutation.mutate();
        }
      }}
    >
      {inactive ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      {archiving ? 'Comprimiendo archivos…' : inactive ? 'Reactivar obra' : 'Marcar inactiva'}
    </Button>
  );
}
