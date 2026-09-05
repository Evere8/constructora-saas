import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { advanced, csv, listMembers, listProjects } = vi.hoisted(() => ({
  advanced: vi.fn(),
  csv: vi.fn(),
  listMembers: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('@/context/CompanyProvider', () => ({
  useCompany: () => ({ activeCompanyId: 'company-1' }),
}));
vi.mock('@/lib/api/modules', () => ({
  reportsApi: { advanced, csv },
  membersApi: { list: listMembers },
  saveBlob: vi.fn(),
}));
vi.mock('@/lib/api/projects', () => ({
  projectsApi: { list: listProjects },
}));

import { ReportsPage } from '@/pages/ReportsPage';

describe('ReportsPage', () => {
  beforeEach(() => {
    listProjects.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    listMembers.mockResolvedValue([]);
    advanced.mockResolvedValue({
      date_from: null,
      date_to: null,
      project_id: null,
      assigned_user_id: null,
      tasks_total: 10,
      tasks_completed: 4,
      tasks_overdue: 2,
      tasks_due_soon: 1,
      tasks_unassigned: 1,
      checklist_total: 20,
      checklist_completed: 15,
      checklist_blocked: 2,
      requirements_at_risk: 3,
      completion_percent: 75,
      status_counts: [{ status: 'completed', count: 4 }],
      projects: [{
        project_id: 'project-1',
        project_name: 'Obra Central',
        tasks_total: 10,
        tasks_completed: 4,
        tasks_overdue: 2,
        completion_percent: 40,
      }],
      assignees: [{
        user_id: 'user-1',
        name: 'Ana Supervisora',
        tasks_total: 6,
        tasks_completed: 3,
        tasks_overdue: 1,
        completion_percent: 50,
      }],
    });
  });

  it('renderiza avance, riesgos y agrupaciones devueltas por la API', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportsPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Obra Central')).toBeInTheDocument();
    expect(screen.getByText('Ana Supervisora')).toBeInTheDocument();
    expect(screen.getByText('Recursos en riesgo')).toBeInTheDocument();
    expect(advanced).toHaveBeenCalledWith('company-1', expect.any(Object), expect.any(AbortSignal));
  });
});
