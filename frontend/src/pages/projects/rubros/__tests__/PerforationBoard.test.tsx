import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerforationWorkspace, ProjectRubro } from '@/types/api';

const { workspace, preview, createAnnotation } = vi.hoisted(() => ({
  workspace: vi.fn(),
  preview: vi.fn(),
  createAnnotation: vi.fn(),
}));

vi.mock('@/auth/useCan', () => ({ useCan: () => true }));
vi.mock('@/lib/api/rubros', () => ({
  rubrosApi: {
    perforationWorkspace: workspace,
    previewPerforationDocument: preview,
    createPerforationAnnotation: createAnnotation,
  },
}));

import { PerforationBoard } from '../PerforationBoard';

const rubro = { id: 'rubro-1', name: 'Perforaciones' } as ProjectRubro;
const board: PerforationWorkspace = {
  rubro,
  colors: [{ id: 'color-1', rubro_id: rubro.id, name: 'Perforado', color_hex: '#ef4444', is_active: true, sort_order: 1, checklist_json: [] }],
  documents: [{ id: 'document-1', company_id: 'company-1', project_id: 'project-1', rubro_id: rubro.id, title: 'Nivel 2', original_filename: 'N2.pdf', mime_type: 'application/pdf', size_bytes: 1024, sha256: 'sample', page_count: 1, created_by_user_id: 'user-1', created_at: '2026-10-20T12:00:00', points_total: 0, points_completed: 0 }],
  points: [],
  annotations: [],
} as PerforationWorkspace;

function firePointer(target: Element, type: string, pointerType: string, pointerId: number, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: pointerId },
  });
  fireEvent(target, event);
}

describe('PerforationBoard on a tablet', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    workspace.mockResolvedValue(board);
    preview.mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
    createAnnotation.mockResolvedValue({ id: 'mark-1', kind: 'line', points: [], document_id: 'document-1', page_number: 1 });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('URL', class MockURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview');
      static revokeObjectURL = vi.fn();
    });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  });

  it('pans with a finger and saves only a pen stroke inside the PDF', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><PerforationBoard companyId="company-1" projectId="project-1" rubro={rubro} /></QueryClientProvider>);
    const image = await screen.findByAltText('Plano de perforaciones Nivel 2');
    const canvas = image.parentElement as HTMLElement;
    const viewport = canvas.parentElement as HTMLElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 } as DOMRect);
    Object.defineProperties(canvas, { offsetWidth: { value: 300 }, offsetHeight: { value: 200 } });
    Object.defineProperties(viewport, { clientWidth: { value: 300 }, clientHeight: { value: 200 } });

    fireEvent.click(screen.getByRole('button', { name: 'Trazo recto' }));
    firePointer(viewport, 'pointerdown', 'touch', 1, 75, 50);
    firePointer(viewport, 'pointermove', 'touch', 1, 225, 150);
    firePointer(viewport, 'pointerup', 'touch', 1, 225, 150);
    expect(createAnnotation).not.toHaveBeenCalled();
    await waitFor(() => expect(canvas.style.transform).toContain('translate(0px, 0px)'));

    firePointer(viewport, 'pointerdown', 'pen', 2, 75, 50);
    firePointer(viewport, 'pointermove', 'pen', 2, 225, 150);
    firePointer(viewport, 'pointerup', 'pen', 2, 225, 150);
    await waitFor(() => expect(createAnnotation).toHaveBeenCalledTimes(1));
    expect(createAnnotation).toHaveBeenCalledWith('company-1', 'project-1', 'rubro-1', expect.objectContaining({
      kind: 'line',
      document_id: 'document-1',
      points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }],
    }));
  });

  it('keeps an unsaved point note when the board refreshes and exposes a close button', async () => {
    const point = {
      id: 'point-1', company_id: 'company-1', project_id: 'project-1', rubro_id: rubro.id,
      document_id: 'document-1', color_id: 'color-1', page_number: 1, created_by_user_id: 'user-1',
      x: '0.5', y: '0.5', diameter: '0.026', color_hex: '#ef4444',
      status: 'pending', checklist_json: [], label: null, note_text: null,
    } as PerforationWorkspace['points'][number];
    workspace.mockResolvedValue({ ...board, points: [point] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><PerforationBoard companyId="company-1" projectId="project-1" rubro={rubro} /></QueryClientProvider>);
    await screen.findByAltText('Plano de perforaciones Nivel 2');
    fireEvent.click(screen.getByRole('button', { name: 'Punto point-1' }));
    const note = screen.getByPlaceholderText('Escribe una observación del punto');
    fireEvent.change(note, { target: { value: 'Sin terminar todavía' } });
    await act(async () => {
      queryClient.setQueryData(['perforation-workspace', 'company-1', 'project-1', rubro.id], {
        ...board, points: [{ ...point, note_text: 'Nota anterior en el servidor' }],
      });
    });
    await waitFor(() => expect(note).toHaveValue('Sin terminar todavía'));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar detalle del punto' }));
    expect(screen.queryByPlaceholderText('Escribe una observación del punto')).not.toBeInTheDocument();
  });
});
