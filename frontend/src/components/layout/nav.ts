import {
  LayoutDashboard,
  Building2,
  Wrench,
  Users,
  BarChart3,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  comingSoon?: boolean;
  end?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Resumen', to: '/', icon: LayoutDashboard, end: true },
  { label: 'Obras', to: '/obras', icon: Building2 },
];

export const SECONDARY_NAV: NavItem[] = [
  { label: 'Herramientas', to: '/inventario', icon: Wrench },
  { label: 'Personal', to: '/personal', icon: Users },
  { label: 'Reportes', to: '/reportes', icon: BarChart3 },
  { label: 'Configuracion', to: '/configuracion', icon: Settings },
];
