import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'unauthenticated',
    updatePassword: vi.fn(),
  }),
}));

import { ResetPasswordPage } from '@/pages/ResetPasswordPage';

describe('ResetPasswordPage', () => {
  it('no permite guardar una contraseña si el enlace no creó una sesión', () => {
    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Enlace no valido' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar contrasena' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Solicitar nuevo enlace' })).toHaveAttribute(
      'href',
      '/recuperar',
    );
  });
});
