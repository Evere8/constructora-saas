import { api } from '@/lib/http';

const base = (companyId: string) => `/v1/companies/${companyId}/push`;

export const pushApi = {
  config: (companyId: string, signal?: AbortSignal) => api.get<{ enabled: boolean; public_key: string | null }>(`${base(companyId)}/config`, undefined, signal),
  save: (companyId: string, subscription: PushSubscriptionJSON) => api.post<void>(`${base(companyId)}/subscriptions`, subscription),
};
