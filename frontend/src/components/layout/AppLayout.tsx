import { NavLink, Outlet } from 'react-router-dom';
import {
  HardHat,
  MoreHorizontal,
  Home,
  Building2,
  UserCircle,
} from 'lucide-react';
import { roleLabel } from '@/auth/permissions';
import { useCompany } from '@/context/CompanyProvider';
import { CompanySelector } from '@/components/layout/CompanySelector';
import { PRIMARY_NAV, SECONDARY_NAV } from '@/components/layout/nav';
import { Badge } from '@/components/ui/badge';
import { UserMenu } from '@/components/layout/UserMenu';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { cn } from '@/lib/utils';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
    isActive
      ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
      : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground',
  );
}

function Sidebar() {
  const { activeMembership } = useCompany();

  return (
    <aside className="hidden w-[18rem] shrink-0 bg-[#090c14] p-3 text-sidebar-foreground lg:flex">
      <div className="flex min-h-full w-full flex-col rounded-3xl border border-sidebar-border/80 bg-sidebar/95 shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <HardHat className="h-6 w-6" />
          </div>
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight">Obrixapy</p>
            <p className="text-xs text-sidebar-foreground/60">Gestión de obra</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          <p className="px-4 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground/40">Espacio de trabajo</p>
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </NavLink>
          ))}

          <p className="px-4 pb-2 pt-7 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground/40">
            Módulos
          </p>
          {SECONDARY_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              <item.icon className="h-[18px] w-[18px]" />
              <span className="flex-1">{item.label}</span>
              {item.comingSoon ? (
                <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                  Pronto
                </Badge>
              ) : null}
            </NavLink>
          ))}

        </nav>

        {activeMembership ? (
          <div className="m-3 rounded-2xl border border-sidebar-border bg-sidebar-accent/50 px-4 py-3 text-xs text-sidebar-foreground/70">
            <p className="truncate font-semibold text-sidebar-foreground">{activeMembership.company_name}</p>
            <p className="mt-0.5">{roleLabel(activeMembership.role)}</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

const MOBILE_NAV = [
  { label: 'Inicio', to: '/', icon: Home, end: true },
  { label: 'Obras', to: '/obras', icon: Building2 },
  { label: 'Perfil', to: '/perfil', icon: UserCircle },
  { label: 'Mas', to: '/mas', icon: MoreHorizontal },
];

function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-card lg:hidden">
      {MOBILE_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
        >
          <item.icon className="h-5 w-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
              <HardHat className="h-4 w-4" />
            </div>
            <CompanySelector />
          </div>
          <div className="flex items-center gap-2">
            <NotificationCenter />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:pb-8">
          <div className="mx-auto w-full max-w-[1500px]">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
