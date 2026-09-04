import { HardHat, ShieldCheck } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { UserMenu } from '@/components/layout/UserMenu';
import { cn } from '@/lib/utils';

export function PlatformLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HardHat className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-base font-semibold">Obrixapy</p>
            <p className="text-xs text-sidebar-foreground/60">Administración global</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-2">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/40">
            Plataforma
          </p>
          <NavLink
            to="/plataforma"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent',
              )
            }
          >
            <ShieldCheck className="h-4 w-4" />
            Constructoras y planes
          </NavLink>
        </nav>
        <div className="border-t border-sidebar-border px-4 py-3 text-xs text-sidebar-foreground/70">
          Panel exclusivo del administrador de plataforma
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
              <HardHat className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Administración de plataforma</p>
              <p className="text-xs text-muted-foreground">Sin acceso operativo a constructoras</p>
            </div>
          </div>
          <UserMenu profilePath="/plataforma/perfil" />
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
