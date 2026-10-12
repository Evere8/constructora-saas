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
    'group/nav flex h-11 items-center justify-center gap-3 overflow-hidden rounded-full px-3 text-sm font-semibold transition-all lg:group-hover/sidebar:justify-start lg:group-focus-within/sidebar:justify-start',
    isActive
      ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
      : 'text-foreground/65 hover:bg-muted hover:text-foreground',
  );
}

function Sidebar() {
  const { activeMembership } = useCompany();

  return (
    <aside className="group/sidebar hidden w-[5.25rem] shrink-0 bg-background p-3 transition-[width] duration-300 hover:w-[17rem] focus-within:w-[17rem] lg:flex">
      <div className="flex min-h-full w-full flex-col overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="flex items-center justify-center gap-3 px-3 py-5 lg:group-hover/sidebar:justify-start lg:group-focus-within/sidebar:justify-start">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <HardHat className="h-6 w-6" />
          </div>
          <div className="max-w-0 overflow-hidden leading-tight opacity-0 transition-all duration-300 lg:group-hover/sidebar:max-w-[10rem] lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:max-w-[10rem] lg:group-focus-within/sidebar:opacity-100">
            <p className="text-lg font-bold tracking-tight">Obrixapy</p>
            <p className="text-xs text-muted-foreground">Gestión de obra</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          <p className="max-h-0 overflow-hidden px-4 pb-0 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground opacity-0 transition-all duration-300 lg:group-hover/sidebar:max-h-8 lg:group-hover/sidebar:pb-2 lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:max-h-8 lg:group-focus-within/sidebar:pb-2 lg:group-focus-within/sidebar:opacity-100">Espacio de trabajo</p>
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 lg:group-hover/sidebar:max-w-[10rem] lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:max-w-[10rem] lg:group-focus-within/sidebar:opacity-100">{item.label}</span>
            </NavLink>
          ))}

          <p className="max-h-0 overflow-hidden px-4 pb-0 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground opacity-0 transition-all duration-300 lg:group-hover/sidebar:mt-5 lg:group-hover/sidebar:max-h-8 lg:group-hover/sidebar:pb-2 lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:mt-5 lg:group-focus-within/sidebar:max-h-8 lg:group-focus-within/sidebar:pb-2 lg:group-focus-within/sidebar:opacity-100">
            Módulos
          </p>
          {SECONDARY_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex min-w-0 flex-1 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 lg:group-hover/sidebar:max-w-[10rem] lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:max-w-[10rem] lg:group-focus-within/sidebar:opacity-100">{item.label}</span>
              {item.comingSoon ? (
                <Badge variant="warning" className="max-w-0 overflow-hidden px-0 py-0 text-[10px] opacity-0 transition-all duration-300 lg:group-hover/sidebar:max-w-12 lg:group-hover/sidebar:px-1.5 lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:max-w-12 lg:group-focus-within/sidebar:px-1.5 lg:group-focus-within/sidebar:opacity-100">
                  Pronto
                </Badge>
              ) : null}
            </NavLink>
          ))}

        </nav>

        {activeMembership ? (
          <div className="m-2 flex justify-center rounded-2xl border bg-muted/40 px-2 py-3 text-xs text-muted-foreground transition-all duration-300 lg:group-hover/sidebar:m-3 lg:group-hover/sidebar:justify-start lg:group-hover/sidebar:px-4 lg:group-focus-within/sidebar:m-3 lg:group-focus-within/sidebar:justify-start lg:group-focus-within/sidebar:px-4">
            <div className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 lg:group-hover/sidebar:max-w-[12rem] lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:max-w-[12rem] lg:group-focus-within/sidebar:opacity-100">
              <p className="truncate font-semibold text-foreground">{activeMembership.company_name}</p>
              <p className="mt-0.5">{roleLabel(activeMembership.role)}</p>
            </div>
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
