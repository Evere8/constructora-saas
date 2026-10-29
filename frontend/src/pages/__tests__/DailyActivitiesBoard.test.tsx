import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DailyActivityPlan } from '@/lib/api/dailyOperations';

const { loadPlan, savePlan } = vi.hoisted(() => ({ loadPlan: vi.fn(), savePlan: vi.fn() }));
vi.mock('@/auth/useCan', () => ({ useCan: () => true }));
vi.mock('@/context/CompanyProvider', () => ({ useCompany: () => ({ activeCompanyId: 'company' }) }));
vi.mock('@/lib/api/projects', () => ({ projectsApi: { listAll: async () => [{ id: 'project', name: 'Obra', status: 'active' }] } }));
vi.mock('@/lib/api/modules', () => ({ inventoryApi: { list: async () => [] } }));
vi.mock('@/lib/api/dailyOperations', () => ({
  operationalToday: () => '2026-10-29',
  dailyOperationsApi: { plan: loadPlan, savePlan, definitions: async () => [{ id: 'activity', title: 'Colocación', requirements: [] }] },
}));
import { DailyActivitiesBoard } from '../DailyActivitiesBoard';

const plan: DailyActivityPlan = { id: 'plan', revision: 'revision-1', plan_date: '2026-10-29', registered_at: null, inventory_registered_at: null, total_people: 6, entries: [{ project_id: 'project', project_name: 'Obra', activity_definition_id: 'activity', activity_title: 'Colocación', people_count: 6, note: null, verification: 'incomplete', missing_tools: [] }] };
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
  expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  expect(savePlan).not.toHaveBeenCalled();
  await act(async () => finish(plan));
  await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(6));
  expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeEnabled();
});

it('retains an edited draft and its original revision after another user updates the day', async () => {
  loadPlan.mockResolvedValue(plan);
  savePlan.mockResolvedValue({ ...plan, revision: 'revision-3' });
  const client = setup();
  await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(6));
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } });
  act(() => client.setQueryData(['daily-activity-plan', 'company', '2026-10-29'], { ...plan, revision: 'revision-2' }));
  expect(screen.getByRole('spinbutton')).toHaveValue(8);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await waitFor(() => expect(savePlan).toHaveBeenCalledWith('company', '2026-10-29', expect.arrayContaining([expect.objectContaining({ people_count: 8 })]), 'revision-1'));
});

it('a failed load cannot overwrite a saved day', async () => {
  loadPlan.mockRejectedValue(new Error('falló la lectura'));
  setup();
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
  expect(savePlan).not.toHaveBeenCalled();
});
