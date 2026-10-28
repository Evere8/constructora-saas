import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/types/api';

const { deactivate, reactivate, membership } = vi.hoisted(() => ({
  deactivate: vi.fn(),
  reactivate: vi.fn(),
  membership: { role: 'engineer' },
}));

vi.mock('@/context/CompanyProvider', () => ({
  useCompany: () => ({ activeCompanyId: 'company-1', activeMembership: membership }),
}));
vi.mock('@/lib/api/projects', () => ({ projectsApi: { deactivate, reactivate } }));

import { ProjectStatusAction } from '@/pages/projects/ProjectStatusAction';

const project = { id: 'project-1', name: 'Obra Central', status: 'active' } as Project;

function renderAction(item: Project) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProjectStatusAction project={item} /></QueryClientProvider>);
}

describe('ProjectStatusAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membership.role = 'engineer';
    deactivate.mockResolvedValue({ ...project, status: 'inactive' });
    reactivate.mockResolvedValue(project);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hides the action from an engineer', () => {
    renderAction(project);
    expect(screen.queryByRole('button', { name: 'Marcar inactiva' })).not.toBeInTheDocument();
  });

  it('asks an administrator for confirmation and updates only the chosen project', async () => {
    membership.role = 'admin';
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderAction(project);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar inactiva' }));
    expect(confirm).toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar inactiva' }));
    await waitFor(() => expect(deactivate).toHaveBeenCalledWith('company-1', 'project-1'));
  });

  it('lets the owner reactivate an inactive project', async () => {
    membership.role = 'owner';
    renderAction({ ...project, status: 'inactive' });
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar obra' }));
    await waitFor(() => expect(reactivate).toHaveBeenCalledWith('company-1', 'project-1'));
  });
});
