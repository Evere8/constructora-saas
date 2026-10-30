import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCompany } from '@/context/CompanyProvider';
import { projectsApi } from '@/lib/api/projects';
import type { TaskStatus } from '@/types/api';

export function TaskNotificationAction() {
  const { activeCompanyId, memberships, setActiveCompanyId } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const handled = useRef('');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ companyId, projectId, taskId, status }: { companyId: string; projectId: string; taskId: string; status: TaskStatus }) => projectsApi.updateTask(companyId, projectId, taskId, { status }),
    onSuccess: (_, variables) => {
      toast.success('Estado de la tarea actualizado');
      void queryClient.invalidateQueries({ queryKey: ['my-work-tasks', variables.companyId] });
      void queryClient.invalidateQueries({ queryKey: ['my-tasks-summary', variables.companyId] });
      void queryClient.invalidateQueries({ queryKey: ['inventory', variables.companyId] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-relocations', variables.companyId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  useEffect(() => {
    if (!activeCompanyId) return;
    const params = new URLSearchParams(location.search);
    const action = params.get('taskAction');
    const taskId = params.get('taskId');
    const projectId = params.get('projectId');
    const requestedCompanyId = params.get('companyId');
    const fromPush = params.get('pushNotification') === '1';
    const companyId = requestedCompanyId && memberships.some((membership) => membership.company_id === requestedCompanyId) ? requestedCompanyId : activeCompanyId;
    const signature = `${action}:${taskId}:${projectId}:${companyId}`;
    if (!fromPush || !companyId || handled.current === signature) return;
    handled.current = signature;
    if (companyId !== activeCompanyId) setActiveCompanyId(companyId);
    params.delete('pushNotification'); params.delete('taskAction'); params.delete('taskId'); params.delete('projectId'); params.delete('companyId');
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: true });
    if (taskId && projectId && ['received', 'in_progress'].includes(action ?? '')) {
      mutation.mutate({ companyId, projectId, taskId, status: action as TaskStatus });
    }
  }, [activeCompanyId, location.pathname, location.search, memberships, mutation, navigate, setActiveCompanyId]);
  return null;
}
