import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const signIn = vi.fn();

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ signIn }),
}));

import { LoginPage } from '@/pages/LoginPage';

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('valida los campos requeridos', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByText('El correo es obligatorio')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('llama a signIn con las credenciales', async () => {
    signIn.mockResolvedValue(undefined);
    renderLogin();
    await userEvent.type(screen.getByLabelText('Correo electronico'), 'obra@empresa.com');
    await userEvent.type(screen.getByLabelText('Contrasena'), 'secreto123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('obra@empresa.com', 'secreto123'));
  });
});
