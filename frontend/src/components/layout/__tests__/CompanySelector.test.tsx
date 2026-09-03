import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/context/CompanyProvider', () => ({
  useCompany: () => ({
    memberships: [],
    activeCompanyId: null,
    activeMembership: null,
    setActiveCompanyId: vi.fn(),
  }),
}));

import { CompanySelector } from '@/components/layout/CompanySelector';

describe('CompanySelector', () => {
  it('muestra el estado vacio cuando no hay constructoras activas', () => {
    render(<CompanySelector />);
    expect(screen.getByText('Sin constructoras activas')).toBeInTheDocument();
  });
});
