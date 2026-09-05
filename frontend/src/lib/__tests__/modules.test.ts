import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession, refreshSession: vi.fn(), signOut: vi.fn() } },
}));

import { documentsApi, plansApi } from '@/lib/api/modules';

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

  it('envía la tolerancia al procesar un documento', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['scan'], 'scan.png', { type: 'image/png' });

    await documentsApi.process('company-1', 'project-1', 'Elongaciones', file, 5);

    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('tolerance_percent')).toBe('5');
  });
});
