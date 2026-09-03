import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useMe } from '@/auth/useMe';
import { FullScreenLoader } from '@/components/common/states';
import { AccessPendingPage } from '@/pages/AccessPendingPage';
import { ApiError } from '@/lib/http';

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
