import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession, refreshSession: vi.fn(), signOut: vi.fn() } },
}));

import {
  documentsApi,
  notificationsApi,
  plansApi,
  reportsApi,
  requirementsApi,
} from '@/lib/api/modules';

describe('API de módulos operativos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  });

  it('carga un plano como multipart sin exponer Content-Type manual', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ versions: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['%PDF-1.7'], 'plano.pdf', { type: 'application/pdf' });

    await plansApi.create('company-1', 'project-1', 'Planta', file);

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const body = options.body as FormData;
    expect(body.get('title')).toBe('Planta');
    expect(body.get('file')).toBe(file);
    expect(options.headers).not.toHaveProperty('Content-Type');
  });

  it('usa las rutas autenticadas del tablero y conserva la geometría normalizada', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ plan_version_id: 'version-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'annotation-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await plansApi.preview('company-1', 'project-1', 'version-1', 2);
    await plansApi.setOverview('company-1', 'project-1', 'version-1');
    await plansApi.createAnnotation('company-1', 'project-1', 'version-1', {
      page_number: 1,
      level_id: 'level-1',
      annotation_type: 'line',
      geometry_json: { points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
    });

    expect(fetchMock.mock.calls[0][0]).toContain('/plans/versions/version-1/preview?page=2');
    expect(fetchMock.mock.calls[1][0]).toContain('/plans/overview');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toMatchObject({
      level_id: 'level-1',
      geometry_json: { points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
    });
  });

  it('envía la tolerancia al procesar un documento', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['scan'], 'scan.png', { type: 'image/png' });

    await documentsApi.process('company-1', 'project-1', 'Elongaciones', file, 5);

    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('tolerance_percent')).toBe('5');
  });

  it('crea un recurso requerido dentro de la tarea correcta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'requirement-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await requirementsApi.create('company-1', 'project-1', 'task-1', {
      description: 'Taladro',
      required_quantity: 1,
      unit: 'unidad',
      availability_status: 'missing',
    });

    expect(fetchMock.mock.calls[0][0]).toContain('/projects/project-1/tasks/task-1/requirements');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('envía los filtros del reporte avanzado como query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projects: [], assignees: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await reportsApi.advanced('company-1', { date_from: '2026-09-01', project_id: 'project-1' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('date_from=2026-09-01');
    expect(url).toContain('project_id=project-1');
  });

  it('marca una alerta como leída mediante la ruta empresarial', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'read' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await notificationsApi.update('company-1', 'notification-1', 'read');

    expect(fetchMock.mock.calls[0][0]).toContain('/companies/company-1/notifications/notification-1');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH' });
  });
});
