import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerforationWorkspace, ProjectRubro } from '@/types/api';

const { workspace, preview, createAnnotation, createPoint, updateChecklist } = vi.hoisted(() => ({
  workspace: vi.fn(),
  preview: vi.fn(),
  createAnnotation: vi.fn(),
  createPoint: vi.fn(),
  updateChecklist: vi.fn(),
}));

vi.mock('@/auth/useMe', () => ({ useMe: () => ({ data: { id: 'test-user' } }) }));
vi.mock('@/auth/useCan', () => ({ useCan: () => true }));
vi.mock('@/lib/api/rubros', () => ({
  rubrosApi: {
    perforationWorkspace: workspace,
    previewPerforationDocument: preview,
    createPerforationAnnotation: createAnnotation,
    createPerforationPoint: createPoint,
    updatePerforationChecklist: updateChecklist,
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

async function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><PerforationBoard companyId="company-1" projectId="project-1" rubro={rubro} /></QueryClientProvider>);
  const image = await screen.findByAltText('Plano de perforaciones Nivel 2');
  const canvas = image.parentElement as HTMLElement;
  const viewport = canvas.parentElement as HTMLElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 } as DOMRect);
  Object.defineProperties(canvas, { offsetWidth: { value: 300, configurable: true }, offsetHeight: { value: 200, configurable: true } });
  Object.defineProperties(viewport, { clientWidth: { value: 300, configurable: true }, clientHeight: { value: 200, configurable: true } });
  return { canvas, viewport, queryClient };
}

describe('PerforationBoard on a tablet', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    workspace.mockResolvedValue(board);
    preview.mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
    createAnnotation.mockResolvedValue({ id: 'mark-1', kind: 'line', points: [], document_id: 'document-1', page_number: 1 });
    createPoint.mockResolvedValue({ id: 'point-new' });
    updateChecklist.mockResolvedValue({ id: 'point-1' });
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

  it('uses a finger or a pen for the chosen tool, without panning the PDF', async () => {
    const { canvas, viewport } = await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Trazo recto' }));
    firePointer(viewport, 'pointerdown', 'touch', 1, 75, 50);
    firePointer(viewport, 'pointermove', 'touch', 1, 225, 150);
    firePointer(viewport, 'pointerup', 'touch', 1, 225, 150);
    await waitFor(() => expect(createAnnotation).toHaveBeenCalledTimes(1));
    expect(createAnnotation).toHaveBeenLastCalledWith('company-1', 'project-1', 'rubro-1', expect.objectContaining({
      kind: 'line',
      document_id: 'document-1',
      points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }],
    }));
    await waitFor(() => expect(canvas.style.transform).toContain('translate(0px, 0px)'));

    firePointer(viewport, 'pointerdown', 'pen', 2, 75, 50);
    firePointer(viewport, 'pointermove', 'pen', 2, 225, 150);
    firePointer(viewport, 'pointerup', 'pen', 2, 225, 150);
    await waitFor(() => expect(createAnnotation).toHaveBeenCalledTimes(2));
  });

  it('pans only in Mover mode and creates a point from a finger tap', async () => {
    const { canvas, viewport } = await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Acercar plano' }));
    await waitFor(() => expect(canvas.style.transform).toContain('scale(1.2)'));
    firePointer(viewport, 'pointerdown', 'touch', 1, 200, 100);
    firePointer(viewport, 'pointermove', 'touch', 1, 160, 80);
    firePointer(viewport, 'pointerup', 'touch', 1, 160, 80);
    await waitFor(() => expect(canvas.style.transform).toContain('translate(-40px, -20px)'));
    expect(createPoint).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Punto' }));
    firePointer(viewport, 'pointerdown', 'touch', 2, 75, 50);
    firePointer(viewport, 'pointermove', 'touch', 2, 125, 100);
    firePointer(viewport, 'pointerup', 'touch', 2, 125, 100);
    expect(createPoint).not.toHaveBeenCalled();
    expect(canvas.style.transform).toContain('translate(-40px, -20px)');

    firePointer(viewport, 'pointerdown', 'touch', 3, 75, 50);
    firePointer(viewport, 'pointerup', 'touch', 3, 75, 50);
    await waitFor(() => expect(createPoint).toHaveBeenCalledTimes(1));
    expect(createPoint).toHaveBeenCalledWith('company-1', 'project-1', 'rubro-1', expect.objectContaining({
      document_id: 'document-1', color_id: 'color-1', x: 0.25, y: 0.25,
    }));
  });

  it('keeps every drawing control usable over the PDF in fullscreen', async () => {
    const { viewport } = await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Pantalla completa' }));
    expect(screen.getByRole('button', { name: 'Mover' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Punto' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lápiz' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Iluminador' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Trazo recto' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Borrador' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Lápiz' }));
    expect(screen.getByLabelText('Grosor del trazo')).toBeVisible();
    firePointer(viewport, 'pointerdown', 'touch', 1, 75, 50);
    firePointer(viewport, 'pointermove', 'touch', 1, 150, 100);
    firePointer(viewport, 'pointerup', 'touch', 1, 150, 100);
    await waitFor(() => expect(createAnnotation).toHaveBeenCalledTimes(1));
    expect(createAnnotation).toHaveBeenLastCalledWith('company-1', 'project-1', 'rubro-1', expect.objectContaining({
      points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeVisible();
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

  it('lets a checklist become the future default for its color', async () => {
    workspace.mockResolvedValue({ ...board, points: [{
      id: 'point-1', company_id: 'company-1', project_id: 'project-1', rubro_id: rubro.id,
      document_id: 'document-1', color_id: 'color-1', page_number: 1, created_by_user_id: 'user-1',
      x: '0.5', y: '0.5', diameter: '0.026', color_hex: '#ef4444', status: 'pending',
      checklist_json: [{ id: 'step-1', title: 'Perforado', checked: false }], label: null, note_text: null,
    }] });
    await renderBoard();
    expect(screen.getByRole('button', { name: 'Editar Perforado' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Punto point-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configurar checklist' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Guardar también como predeterminado/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar checklist' }));
    await waitFor(() => expect(updateChecklist).toHaveBeenCalledWith(
      'company-1', 'project-1', 'rubro-1', 'point-1',
      [{ id: 'point-step-1', title: 'Perforado', checked: false }], true,
    ));
  });
});
