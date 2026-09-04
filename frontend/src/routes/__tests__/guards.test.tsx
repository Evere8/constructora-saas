import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: vi.fn() }));
vi.mock('@/auth/useMe', () => ({ useMe: vi.fn() }));
vi.mock('@/context/CompanyProvider', () => ({ useCompany: vi.fn() }));

import { useAuth } from '@/auth/AuthProvider';
import { useMe } from '@/auth/useMe';
import { useCompany } from '@/context/CompanyProvider';
import { CompanyRoute, PlatformRoute, ProtectedRoute } from '@/routes/guards';

const mockUseAuth = vi.mocked(useAuth);
const mockUseMe = vi.mocked(useMe);
const mockUseCompany = vi.mocked(useCompany);

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/login" element={<div>Pantalla de login</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/private" element={<div>Contenido privado</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirige a /login cuando no hay sesion', () => {
    mockUseAuth.mockReturnValue({ status: 'unauthenticated' } as ReturnType<typeof useAuth>);
    renderGuard();
    expect(screen.getByText('Pantalla de login')).toBeInTheDocument();
  });

  it('muestra el contenido cuando hay sesion', () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' } as ReturnType<typeof useAuth>);
    renderGuard();
    expect(screen.getByText('Contenido privado')).toBeInTheDocument();
  });

  it('muestra un cargador mientras verifica la sesion', () => {
    mockUseAuth.mockReturnValue({ status: 'loading' } as ReturnType<typeof useAuth>);
    renderGuard();
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
  });
});

function renderRoleGuard(kind: 'company' | 'platform') {
  const Guard = kind === 'company' ? CompanyRoute : PlatformRoute;
  return render(
    <MemoryRouter initialEntries={[kind === 'company' ? '/empresa' : '/admin-protegido']}>
      <Routes>
        <Route path="/" element={<div>Inicio empresa</div>} />
        <Route path="/plataforma" element={<div>Inicio plataforma</div>} />
        <Route element={<Guard />}>
          <Route
            path={kind === 'company' ? '/empresa' : '/admin-protegido'}
            element={<div>Contenido autorizado</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('separación entre plataforma y constructora', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCompany.mockReturnValue({ activeMembership: null } as ReturnType<typeof useCompany>);
  });

  it('redirige al administrador de plataforma fuera del panel de constructora', () => {
    mockUseMe.mockReturnValue({
      data: { status: 'active', is_platform_admin: true, memberships: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);

    renderRoleGuard('company');
    expect(screen.getByText('Inicio plataforma')).toBeInTheDocument();
  });

  it('permite el panel empresarial solo con membresía activa', () => {
    mockUseMe.mockReturnValue({
      data: { status: 'active', is_platform_admin: false, memberships: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);
    mockUseCompany.mockReturnValue({
      activeMembership: { company_id: 'c1' },
    } as ReturnType<typeof useCompany>);

    renderRoleGuard('company');
    expect(screen.getByText('Contenido autorizado')).toBeInTheDocument();
  });

  it('impide que un usuario empresarial abra el panel de plataforma', () => {
    mockUseMe.mockReturnValue({
      data: { status: 'active', is_platform_admin: false, memberships: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);

    renderRoleGuard('platform');
    expect(screen.getByText('Inicio empresa')).toBeInTheDocument();
  });
});
