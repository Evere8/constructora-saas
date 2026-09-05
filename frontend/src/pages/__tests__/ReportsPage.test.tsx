import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { overview } = vi.hoisted(() => ({ overview: vi.fn() }));

vi.mock('@/context/CompanyProvider', () => ({
  useCompany: () => ({ activeCompanyId: 'company-1' }),
}));
vi.mock('@/lib/api/modules', () => ({ reportsApi: { overview } }));

import { ReportsPage } from '@/pages/ReportsPage';

describe('ReportsPage', () => {
  beforeEach(() => {
    overview.mockResolvedValue({
      projects_total: 3,
      projects_active: 2,
      tasks_total: 10,
      tasks_completed: 4,
      checklist_total: 20,
      checklist_completed: 15,
      completion_percent: 75,
      inventory_total: 8,
      inventory_assigned: 5,
      members_active: 6,
    });
  });

  it('renderiza el resumen devuelto por la API', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportsPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(overview).toHaveBeenCalledWith('company-1', expect.any(AbortSignal));
  });
});
