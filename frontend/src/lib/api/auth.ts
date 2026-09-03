import { api } from '@/lib/http';
import type { AuthMe } from '@/types/api';

export const authApi = {
  me: (signal?: AbortSignal) => api.get<AuthMe>('/v1/auth/me', undefined, signal),
};
