import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TheoryActions } from '../elongations/ElongationReaderTools';
import { elongationsApi } from '@/lib/api/elongations';
import type { ElongationJobV2 } from '@/types/api';

vi.mock('@/auth/useCan', () => ({ useCan: () => true }));
vi.mock('@/lib/api/elongations', () => ({
  readingBusy: (job: ElongationJobV2) => job.workflow_status === 'processing_theory',
  elongationsApi: { ocrStatus: vi.fn(), createItem: vi.fn(), reviewTheories: vi.fn(), rereadTheory: vi.fn() },
}));

const refresh = vi.fn();
function show(conflict = false) {
  const job = { id: 'job', workflow_status: 'theory_review', version_number: 3,
    items: [{ id: 'item', label: 'T8', classification: 'distributed', theory_review_status: conflict ? 'conflict' : 'pending' }],
  } as ElongationJobV2;
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TheoryActions companyId="company" projectId="project" job={job} refresh={refresh} />
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(elongationsApi.ocrStatus).mockResolvedValue({ visual_enabled: false, handwriting_enabled: false, provider: 'local', model: null });
  vi.mocked(elongationsApi.createItem).mockResolvedValue({} as ElongationJobV2);
  vi.mocked(elongationsApi.reviewTheories).mockResolvedValue({} as ElongationJobV2);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

it('permite cargar la teoría faltante con todos los campos y coma decimal', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Agregar teoría faltante' }));
  fireEvent.change(screen.getByLabelText('Label del plano'), { target: { value: 'T9' } });
  fireEvent.change(screen.getByLabelText('Longitud (m)'), { target: { value: '8,250' } });
  fireEvent.change(screen.getByLabelText('Elongación calculada (cm)'), { target: { value: '5,0' } });
  fireEvent.change(screen.getByLabelText('S / cantidad de tendones'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar y crear sus mediciones' }));
  await waitFor(() => expect(elongationsApi.createItem).toHaveBeenCalledWith('company', 'project', 'job',
    expect.objectContaining({ label: 'T9', length_m: '8,250', strand_count: 2, calculated_elongation: '5,0' })));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});

it('revisa todos en una operación y exige resolver conflictos individualmente', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar todas las teorías (1)' }));
  await waitFor(() => expect(elongationsApi.reviewTheories).toHaveBeenCalledWith('company', 'project', 'job', ['item'], 3));
});

it('no permite aprobar en bloque una lectura contradictoria', () => {
  show(true);
  expect(screen.getByRole('button', { name: 'Revisar todas las teorías (1)' })).toBeDisabled();
  expect(screen.getByText(/Antes de revisar todas.*T8/)).toBeInTheDocument();
});
