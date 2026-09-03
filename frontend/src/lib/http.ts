import { supabase } from '@/lib/supabase';
import { env } from '@/env';

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly payload: unknown;

  constructor(status: number, detail: string, payload?: unknown) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.payload = payload;
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  params?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function buildUrl(path: string, params?: QueryParams): string {
  const base = env.apiBaseUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${suffix}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function doFetch(
  method: string,
  url: string,
  token: string | null,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(url, { method, headers, body: payload, signal });
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Solicitud invalida.';
    case 401:
      return 'Tu sesion expiro. Inicia sesion nuevamente.';
    case 403:
      return 'No tienes acceso a esta empresa o accion.';
    case 404:
      return 'No se encontro el recurso solicitado.';
    case 409:
      return 'Conflicto: el recurso ya existe o esta en uso.';
    case 422:
      return 'Datos invalidos. Revisa el formulario.';
    default:
      return status >= 500 ? 'Error del servidor. Intenta mas tarde.' : 'Ocurrio un error inesperado.';
  }
}

function extractDetail(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((entry) =>
          entry && typeof entry === 'object' && 'msg' in entry
            ? String((entry as { msg: unknown }).msg)
            : '',
        )
        .filter(Boolean);
      if (messages.length > 0) return messages.join(' ');
    }
  }
  return defaultMessage(status);
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, extractDetail(data, response.status), data);
  }
  return data as T;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, options.params);
  let token = await getAccessToken();

  let response: Response;
  try {
    response = await doFetch(method, url, token, options.body, options.signal);
  } catch (error) {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Verifica tu conexion.', error);
  }

  // On 401: refresh session once and retry a single time.
  if (response.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      token = data.session.access_token;
      try {
        response = await doFetch(method, url, token, options.body, options.signal);
      } catch (fetchError) {
        throw new ApiError(0, 'No se pudo conectar con el servidor. Verifica tu conexion.', fetchError);
      }
    }
    if (response.status === 401) {
      await supabase.auth.signOut();
      throw new ApiError(401, defaultMessage(401));
    }
  }

  return parseResponse<T>(response);
}

export const api = {
  get: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    apiRequest<T>('GET', path, { params, signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, { body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, { body }),
  del: <T>(path: string) => apiRequest<T>('DELETE', path),
};
