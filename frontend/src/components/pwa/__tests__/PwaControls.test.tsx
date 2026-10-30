import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { config, save } = vi.hoisted(() => ({ config: vi.fn(), save: vi.fn() }));

vi.mock('@/context/CompanyProvider', () => ({
  useCompany: () => ({ activeCompanyId: 'company-2' }),
}));
vi.mock('@/lib/api/push', () => ({ pushApi: { config, save } }));

import { PwaControls } from '../PwaControls';

const subscription = {
  toJSON: () => ({
    endpoint: 'https://push.example.test/device',
    keys: { p256dh: 'p'.repeat(80), auth: 'a'.repeat(24) },
  }),
};

describe('PwaControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mockResolvedValue({ enabled: true, public_key: 'B'.repeat(87) });
    save.mockResolvedValue(undefined);
    vi.stubGlobal('PushManager', class PushManager {});
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(subscription),
            subscribe: vi.fn(),
          },
        }),
      },
    });
  });

  it('registers an existing installed-app subscription for the active company', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><PwaControls /></QueryClientProvider>);
    await waitFor(() => expect(save).toHaveBeenCalledWith('company-2', subscription.toJSON()));
    expect(screen.getByRole('button', { name: /Avisos activos/ })).toBeDisabled();
  });
});
