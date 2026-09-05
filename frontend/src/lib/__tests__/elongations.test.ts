import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession, refreshSession: vi.fn(), signOut: vi.fn() } },
}));

import { elongationsApi } from '@/lib/api/elongations';

describe('API V2 de elongaciones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  });

  it('crea el trabajo con exactamente un plano y una plantilla XLSX', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'job-1' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const plan = new File(['%PDF-1.7'], 'plano.pdf', { type: 'application/pdf' });
    const template = new File(['xlsx'], 'plantilla.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await elongationsApi.create('company-1', 'project-1', {
      title: 'Elongaciones nivel 1',
      planFile: plan,
      templateFile: template,
      levelId: 'level-1',
    });

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const body = options.body as FormData;
    expect(fetchMock.mock.calls[0][0]).toContain('/projects/project-1/elongation-jobs');
    expect(options.headers).not.toHaveProperty('Content-Type');
    expect(body.get('title')).toBe('Elongaciones nivel 1');
    expect(body.get('plan_file')).toBe(plan);
    expect(body.get('template_file')).toBe(template);
    expect(body.get('plan_version_id')).toBeNull();
  });

  it('carga múltiples fotos sin inventar un encabezado Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'job-1' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = new File(['one'], 'medicion-1.jpg', { type: 'image/jpeg' });
    const second = new File(['two'], 'medicion-2.jpg', { type: 'image/jpeg' });

    await elongationsApi.uploadMeasurements('company-1', 'project-1', 'job-1', [first, second]);

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const body = options.body as FormData;
    expect(options.headers).not.toHaveProperty('Content-Type');
    expect(body.getAll('files')).toEqual([first, second]);
  });

  it('usa rutas V2 separadas para aprobación y Excel final', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await elongationsApi.approveTheory('company-1', 'project-1', 'job-1');
    await elongationsApi.approveFinal('company-1', 'project-1', 'job-1');

    expect(fetchMock.mock.calls[0][0]).toContain('/elongation-jobs/job-1/approve-theory');
    expect(fetchMock.mock.calls[1][0]).toContain('/elongation-jobs/job-1/approve-final');
  });

  it('guarda zonas de revisión y descarga la vista previa autenticada', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('preview', { status: 200, headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);

    await elongationsApi.createZone('company-1', 'project-1', 'job-1', {
      classification: 'band',
      name: 'Borde norte',
      geometry: { page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    });
    const preview = await elongationsApi.preview('company-1', 'project-1', 'job-1', 'plan-1', 2);

    expect(fetchMock.mock.calls[0][0]).toContain('/classification-zones');
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      classification: 'band',
      geometry: { page: 1 },
    });
    expect(fetchMock.mock.calls[1][0]).toContain('/files/plan-1/preview?page=2');
    expect(preview).toBeInstanceOf(Blob);
  });
});
