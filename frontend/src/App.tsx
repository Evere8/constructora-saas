import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/auth/AuthProvider';
import { CompanyProvider } from '@/context/CompanyProvider';
import { Toaster } from '@/components/ui/sonner';
import {
  AccountGate,
  CompanyRoute,
  PlatformRoute,
  ProtectedRoute,
  PublicOnly,
} from '@/routes/guards';
import { AppLayout } from '@/components/layout/AppLayout';
import { PlatformLayout } from '@/components/layout/PlatformLayout';
import { LoginPage } from '@/pages/LoginPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { FullScreenLoader } from '@/components/common/states';
import { NotFoundPage } from '@/pages/NotFoundPage';

const InventoryPage = lazy(() =>
  import('@/pages/InventoryPage').then((module) => ({ default: module.InventoryPage })),
);
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const ProjectsListPage = lazy(() =>
  import('@/pages/projects/ProjectsListPage').then((module) => ({ default: module.ProjectsListPage })),
);
const ProjectDetailPage = lazy(() =>
  import('@/pages/projects/ProjectDetailPage').then((module) => ({ default: module.ProjectDetailPage })),
);
const MorePage = lazy(() =>
  import('@/pages/MorePage').then((module) => ({ default: module.MorePage })),
);
const ProfilePage = lazy(() =>
  import('@/pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);
const PlatformPage = lazy(() =>
  import('@/pages/platform/PlatformPage').then((module) => ({ default: module.PlatformPage })),
);
const PersonnelPage = lazy(() =>
  import('@/pages/PersonnelPage').then((module) => ({ default: module.PersonnelPage })),
);
const ReportsPage = lazy(() =>
  import('@/pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CompanyProvider>
          <BrowserRouter>
            <Suspense fallback={<FullScreenLoader label="Cargando módulo..." />}>
              <Routes>
                <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
                <Route path="/recuperar" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
                <Route path="/restablecer" element={<ResetPasswordPage />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<AccountGate />}>
                    <Route element={<PlatformRoute />}>
                      <Route element={<PlatformLayout />}>
                        <Route path="plataforma" element={<PlatformPage />} />
                        <Route path="plataforma/perfil" element={<ProfilePage />} />
                      </Route>
                    </Route>
                    <Route element={<CompanyRoute />}>
                      <Route element={<AppLayout />}>
                        <Route index element={<DashboardPage />} />
                        <Route path="obras" element={<ProjectsListPage />} />
                        <Route path="obras/:projectId" element={<ProjectDetailPage />} />
                        <Route path="tareas" element={<Navigate to="/obras" replace />} />
                        <Route path="checklist" element={<Navigate to="/obras" replace />} />
                        <Route path="mas" element={<MorePage />} />
                        <Route path="perfil" element={<ProfilePage />} />
                        <Route path="inventario" element={<InventoryPage />} />
                        <Route path="planos" element={<Navigate to="/obras" replace />} />
                        <Route path="elongaciones" element={<Navigate to="/obras" replace />} />
                        <Route path="personal" element={<PersonnelPage />} />
                        <Route path="reportes" element={<ReportsPage />} />
                        <Route path="configuracion" element={<SettingsPage />} />
                      </Route>
                    </Route>
                  </Route>
                </Route>

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
            <Toaster />
          </BrowserRouter>
        </CompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
