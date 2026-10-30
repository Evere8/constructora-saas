import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const { updateTask, setActiveCompanyId } = vi.hoisted(() => ({
  updateTask: vi.fn(),
  setActiveCompanyId: vi.fn(),
}));

vi.mock('@/context/CompanyProvider', () => ({
  useCompany: () => ({
    activeCompanyId: 'company-1',
    memberships: [{ company_id: 'company-1' }, { company_id: 'company-2' }],
    setActiveCompanyId,
  }),
}));
vi.mock('@/lib/api/projects', () => ({ projectsApi: { updateTask } }));

import { TaskNotificationAction } from '../TaskNotificationAction';

function CurrentSearch() {
  return <span>{useLocation().search || 'clean'}</span>;
}

it('applies the Recibido notification action and removes its one-time URL parameters', async () => {
  updateTask.mockResolvedValue({ id: 'task-1', status: 'received' });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tareas?pushNotification=1&taskAction=received&taskId=task-1&projectId=project-1&companyId=company-2']}>
        <TaskNotificationAction />
        <Routes><Route path="/tareas" element={<CurrentSearch />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(updateTask).toHaveBeenCalledWith(
    'company-2',
    'project-1',
    'task-1',
    { status: 'received' },
  ));
  expect(setActiveCompanyId).toHaveBeenCalledWith('company-2');
  await waitFor(() => expect(screen.getByText('clean')).toBeVisible());
});

it('switches to the notification company when the notification body is opened', async () => {
  updateTask.mockClear();
  setActiveCompanyId.mockClear();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tareas?pushNotification=1&companyId=company-2']}>
        <TaskNotificationAction />
        <Routes><Route path="/tareas" element={<CurrentSearch />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(setActiveCompanyId).toHaveBeenCalledWith('company-2'));
  expect(updateTask).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText('clean')).toBeVisible());
});
