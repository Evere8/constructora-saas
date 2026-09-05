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
import { cn } from '@/lib/utils';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
  );
}

function Sidebar() {
  const { activeMembership } = useCompany();

  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex items-center gap-2 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <HardHat className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-base font-semibold">Obrixapy</p>
          <p className="text-xs text-sidebar-foreground/60">Gestion de obra</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}

        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/40">
          Modulos
        </p>
        {SECONDARY_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className={navLinkClass}>
            <item.icon className="h-4 w-4" />
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
        <div className="border-t border-sidebar-border px-4 py-3 text-xs text-sidebar-foreground/70">
          <p className="font-medium text-sidebar-foreground">{activeMembership.company_name}</p>
          <p>{roleLabel(activeMembership.role)}</p>
        </div>
      ) : null}
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
          <UserMenu />
        </header>
        <main className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:pb-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
