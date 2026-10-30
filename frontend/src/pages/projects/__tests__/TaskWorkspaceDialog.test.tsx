import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { list, progress, deleteTask } = vi.hoisted(() => ({
  list: vi.fn(),
  progress: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock('@/auth/useCan', () => ({
  useCan: () => true,
  useCanAssigned: () => () => true,
}));
vi.mock('@/lib/api/checklist', () => ({
  checklistApi: {
    list,
    progress,
    update: vi.fn(),
  },
}));
vi.mock('@/lib/api/projects', () => ({
  projectsApi: { deleteTask },
}));
vi.mock('@/pages/projects/ChecklistFormDialog', () => ({
  ChecklistFormDialog: () => <div>Formulario de control</div>,
}));
vi.mock('@/pages/projects/ChecklistEvidenceDialog', () => ({
  ChecklistEvidenceDialog: ({ item }: { item: { title: string } }) => (
    <div>Evidencia de {item.title}</div>
  ),
}));

import { TaskWorkspaceDialog } from '@/pages/projects/TaskWorkspaceDialog';
import type { Task } from '@/types/api';

const task: Task = {
  id: 'task-1',
  project_id: 'project-1',
  level_id: 'level-1',
  title: 'Hormigonar fundaciones',
  description: 'Controlar armadura y nivel antes del colado.',
  task_type: 'work',
  status: 'in_progress',
  priority: 'high',
};

function renderWorkspace(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskWorkspaceDialog
        companyId="company-1"
        projectId="project-1"
        task={task}
        levelName="Fundaciones"
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
}

describe('TaskWorkspaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({
      items: [
        {
          id: 'check-1',
          company_id: 'company-1',
          project_id: 'project-1',
          task_id: 'task-1',
          title: 'Verificar armadura',
          process_stage: 'Previo al colado',
          status: 'completed',
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
    });
    progress.mockResolvedValue({
      total: 1,
      completed: 1,
      completion_percent: 100,
    });
    deleteTask.mockResolvedValue(undefined);
  });

  it('muestra el checklist y las evidencias dentro de la tarea', async () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: task.title })).toBeInTheDocument();
    expect(await screen.findByText('Verificar armadura')).toBeInTheDocument();
    expect(screen.getByText('1/1 controles completados')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Evidencias' }));
    await waitFor(() => {
      expect(screen.getByText('Evidencia de Verificar armadura')).toBeInTheDocument();
    });

    expect(list).toHaveBeenCalledWith(
      'company-1',
      'project-1',
      { task_id: 'task-1', limit: 200 },
      expect.any(AbortSignal),
    );
  });

  it('permite al propietario o ingeniero eliminar la tarea desde su espacio de trabajo', async () => {
    const onOpenChange = vi.fn();
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWorkspace(onOpenChange);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar tarea' }));
    await waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith('company-1', 'project-1', 'task-1');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    confirmation.mockRestore();
  });
});
