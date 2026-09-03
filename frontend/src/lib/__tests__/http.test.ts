import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSession, refreshSession, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession, refreshSession, signOut },
  },
}));

import { apiRequest, ApiError } from '@/lib/http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  });

  it('envia el token Bearer y parsea JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiRequest<{ ok: boolean }>('GET', '/v1/test');
    expect(result).toEqual({ ok: true });

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('refresca la sesion una vez ante 401 y reintenta', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    refreshSession.mockResolvedValue({ data: { session: { access_token: 'tok2' } }, error: null });

    const result = await apiRequest<{ ok: boolean }>('GET', '/v1/test');
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it('cierra sesion si el 401 persiste tras refrescar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'expired' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    refreshSession.mockResolvedValue({ data: { session: { access_token: 'tok2' } }, error: null });
    signOut.mockResolvedValue({});

    await expect(apiRequest('GET', '/v1/test')).rejects.toBeInstanceOf(ApiError);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('no reintenta ante 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'forbidden' }, 403));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('GET', '/v1/test')).rejects.toMatchObject({
      status: 403,
      detail: 'forbidden',
    });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mapea errores de validacion 422 al primer mensaje', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: [{ msg: 'campo requerido' }] }, 422));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('POST', '/x', { body: {} })).rejects.toMatchObject({
      status: 422,
      detail: 'campo requerido',
    });
  });

  it('convierte errores de red en ApiError con status 0', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('GET', '/v1/test')).rejects.toMatchObject({ status: 0 });
  });
});
