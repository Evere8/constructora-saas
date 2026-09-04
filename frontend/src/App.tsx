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
import { DashboardPage } from '@/pages/DashboardPage';
import { ProjectsListPage } from '@/pages/projects/ProjectsListPage';
import { ProjectDetailPage } from '@/pages/projects/ProjectDetailPage';
import { MorePage } from '@/pages/MorePage';
import { ProfilePage } from '@/pages/ProfilePage';
import { PlatformPage } from '@/pages/platform/PlatformPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CompanyProvider>
          <BrowserRouter>
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
                      <Route path="inventario" element={<ComingSoonPage title="Inventario" />} />
                      <Route path="planos" element={<ComingSoonPage title="Planos" />} />
                      <Route path="elongaciones" element={<ComingSoonPage title="Elongaciones" />} />
                      <Route path="personal" element={<ComingSoonPage title="Personal" />} />
                      <Route path="reportes" element={<ComingSoonPage title="Reportes" />} />
                      <Route path="configuracion" element={<ComingSoonPage title="Configuracion" />} />
                    </Route>
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            <Toaster />
          </BrowserRouter>
        </CompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
