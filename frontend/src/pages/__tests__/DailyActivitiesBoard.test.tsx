import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DailyActivityPlan } from '@/lib/api/dailyOperations';

const { loadPlan, savePlan } = vi.hoisted(() => ({ loadPlan: vi.fn(), savePlan: vi.fn() }));
vi.mock('@/auth/useCan', () => ({ useCan: () => true }));
vi.mock('@/context/CompanyProvider', () => ({ useCompany: () => ({ activeCompanyId: 'company' }) }));
vi.mock('@/lib/api/projects', () => ({ projectsApi: { listAll: async () => [{ id: 'project', name: 'Obra', status: 'active' }] } }));
vi.mock('@/lib/api/modules', () => ({ inventoryApi: { list: async () => [{ id: 'tool', name: 'Taladro' }] }, membersApi: { list: async () => [] } }));
vi.mock('@/lib/api/dailyOperations', () => ({
  operationalToday: () => '2026-10-29',
  dailyOperationsApi: { plan: loadPlan, savePlan, definitions: async () => [{ id: 'activity', title: 'Colocación', requirements: [{ name: 'Taladro', quantity: 2 }] }] },
}));
import { DailyActivitiesBoard } from '../DailyActivitiesBoard';

const plan: DailyActivityPlan = { id: 'plan', revision: 'revision-1', plan_date: '2026-10-29', registered_at: null, inventory_registered_at: null, total_people: 6, entries: [{ project_id: 'project', project_name: 'Obra', activity_definition_id: 'activity', activity_title: 'Colocación', assigned_user_id: null, assigned_user_name: null, task_id: null, task_status: null, custom_status_label: null, people_count: 6, note: null, verification: 'incomplete', missing_tools: [] }] };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><DailyActivitiesBoard /></QueryClientProvider>);
  return client;
}
beforeEach(() => vi.resetAllMocks());

it('does not enable saving an empty draft before the existing day loads', async () => {
  let finish!: (value: DailyActivityPlan) => void;
  loadPlan.mockReturnValue(new Promise<DailyActivityPlan>(resolve => { finish = resolve; }));
  setup();
  expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  expect(savePlan).not.toHaveBeenCalled();
  await act(async () => finish(plan));
  const people = await screen.findByRole('spinbutton', { name: 'Personal para Colocación' });
  expect(people).toHaveValue(6);
  fireEvent.change(people, { target: { value: '7' } });
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
});

it('retains an edited draft and its original revision after another user updates the day', async () => {
  loadPlan.mockResolvedValue(plan);
  savePlan.mockResolvedValue({ ...plan, revision: 'revision-3' });
  const client = setup();
  const people = await screen.findByRole('spinbutton', { name: 'Personal para Colocación' });
  expect(people).toHaveValue(6);
  fireEvent.change(people, { target: { value: '8' } });
  act(() => { client.setQueryData(['daily-activity-plan', 'company', '2026-10-29'], { ...plan, revision: 'revision-2' }); });
  expect(people).toHaveValue(8);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(savePlan).toHaveBeenCalledWith('company', '2026-10-29', expect.arrayContaining([expect.objectContaining({ people_count: 8 })]), 'revision-1'));
});

it('a failed load cannot overwrite a saved day', async () => {
  loadPlan.mockRejectedValue(new Error('falló la lectura'));
  setup();
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  expect(savePlan).not.toHaveBeenCalled();
});

it('suggests a previous activity and restores all of its required tools', async () => {
  loadPlan.mockResolvedValue({ ...plan, entries: [] });
  setup();
  const title = await screen.findByRole('combobox', { name: 'Actividad' });
  fireEvent.change(title, { target: { value: 'Colocación' } });
  expect(screen.getByRole('button', { name: 'Taladro × 2 · Quitar' })).toBeInTheDocument();
});
