import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: vi.fn() }));
vi.mock('@/auth/useMe', () => ({ useMe: vi.fn() }));

import { useAuth } from '@/auth/AuthProvider';
import { ProtectedRoute } from '@/routes/guards';

const mockUseAuth = vi.mocked(useAuth);

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
