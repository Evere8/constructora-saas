import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useMe } from '@/auth/useMe';
import { FullScreenLoader } from '@/components/common/states';
import { AccessPendingPage } from '@/pages/AccessPendingPage';
import { ApiError } from '@/lib/http';
import { useCompany } from '@/context/CompanyProvider';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AccountGate() {
  const { data: me, isLoading, error, refetch } = useMe();

  if (isLoading) return <FullScreenLoader label="Verificando tu acceso..." />;

  if (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    if (status === 403) {
      return <AccessPendingPage variant="blocked" />;
    }
    return <AccessPendingPage variant="error" message={error instanceof Error ? error.message : undefined} onRetry={() => void refetch()} />;
  }

  if (me && me.status !== 'active') {
    return <AccessPendingPage variant={me.status === 'blocked' ? 'blocked' : 'pending'} />;
  }

  return <Outlet />;
}

export function PlatformRoute() {
  const { data: me, isLoading } = useMe();

  if (isLoading) return <FullScreenLoader label="Verificando acceso de plataforma..." />;
  if (!me?.is_platform_admin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function CompanyRoute() {
  const { data: me, isLoading } = useMe();
  const { activeMembership } = useCompany();

  if (isLoading) return <FullScreenLoader label="Verificando tu constructora..." />;
  if (me?.is_platform_admin) return <Navigate to="/plataforma" replace />;
  if (!activeMembership) {
    return (
      <AccessPendingPage
        variant="pending"
        message="Tu cuenta está activa, pero todavía no tiene una constructora habilitada. Pide al administrador de plataforma que complete tu asignación."
      />
    );
  }
  return <Outlet />;
}
