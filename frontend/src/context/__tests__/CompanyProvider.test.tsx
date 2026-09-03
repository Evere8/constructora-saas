import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/auth/useMe', () => ({ useMe: vi.fn() }));

import { useMe } from '@/auth/useMe';
import { CompanyProvider, useCompany } from '@/context/CompanyProvider';

const mockUseMe = vi.mocked(useMe);

function Consumer() {
  const { memberships, activeCompanyId } = useCompany();
  return (
    <div>
      <span data-testid="count">{memberships.length}</span>
      <span data-testid="active">{activeCompanyId}</span>
    </div>
  );
}

describe('CompanyProvider (selector de empresa)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('solo incluye membresias activas y elige la primera por defecto', () => {
    mockUseMe.mockReturnValue({
      data: {
        status: 'active',
        is_platform_admin: false,
        memberships: [
          { company_id: 'c1', name: 'Uno', slug: 'uno', status: 'active', role: 'owner', membership_status: 'active' },
          { company_id: 'c2', name: 'Dos', slug: 'dos', status: 'inactive', role: 'owner', membership_status: 'active' },
          { company_id: 'c3', name: 'Tres', slug: 'tres', status: 'active', role: 'owner', membership_status: 'inactive' },
        ],
      },
    } as unknown as ReturnType<typeof useMe>);

    render(
      <CompanyProvider>
        <Consumer />
      </CompanyProvider>,
    );

    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('active').textContent).toBe('c1');
  });

  it('no selecciona empresa cuando no hay membresias activas', () => {
    mockUseMe.mockReturnValue({
      data: { status: 'active', is_platform_admin: false, memberships: [] },
    } as unknown as ReturnType<typeof useMe>);

    render(
      <CompanyProvider>
        <Consumer />
      </CompanyProvider>,
    );

    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('active').textContent).toBe('');
  });
});
