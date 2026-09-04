import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  session: Session | null;
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

function mapAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) {
    return 'Correo o contrasena incorrectos.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'Debes confirmar tu correo antes de iniciar sesion.';
  }
  if (normalized.includes('rate limit')) {
    return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
  }
  return message;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitialized(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setInitialized(true);
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      status: !initialized ? 'loading' : session ? 'authenticated' : 'unauthenticated',
      signIn: async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(mapAuthError(error.message));
      },
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.clear();
      },
      sendPasswordReset: async (email: string) => {
        const redirectTo = `${window.location.origin}/restablecer`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw new Error(error.message);
      },
      updatePassword: async (password: string) => {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error(mapAuthError(error.message));
      },
    }),
    [session, initialized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
