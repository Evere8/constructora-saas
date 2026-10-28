import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  const mutation = useMutation({
    mutationFn: () => inactive
      ? projectsApi.reactivate(activeCompanyId as string, project.id)
      : projectsApi.deactivate(activeCompanyId as string, project.id),
    onSuccess: () => {
      toast.success(inactive ? 'Obra reactivada' : 'Obra marcada como inactiva');
      void queryClient.invalidateQueries({ queryKey: ['projects', activeCompanyId] });
      void queryClient.invalidateQueries({ queryKey: ['project', activeCompanyId, project.id] });
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
      {inactive ? 'Reactivar obra' : 'Marcar inactiva'}
    </Button>
  );
}
