import {
  LayoutDashboard,
  Building2,
  ListChecks,
  ClipboardCheck,
  Package,
  Map,
  Ruler,
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
  { label: 'Tareas', to: '/tareas', icon: ListChecks },
  { label: 'Checklist', to: '/checklist', icon: ClipboardCheck },
];

export const SECONDARY_NAV: NavItem[] = [
  { label: 'Inventario', to: '/inventario', icon: Package, comingSoon: true },
  { label: 'Planos', to: '/planos', icon: Map, comingSoon: true },
  { label: 'Elongaciones', to: '/elongaciones', icon: Ruler, comingSoon: true },
  { label: 'Personal', to: '/personal', icon: Users, comingSoon: true },
  { label: 'Reportes', to: '/reportes', icon: BarChart3, comingSoon: true },
  { label: 'Configuracion', to: '/configuracion', icon: Settings, comingSoon: true },
];
