import type { Role } from '@/types/api';

export type Capability =
  | 'projects.edit'
  | 'levels.edit'
  | 'tasks.edit'
  | 'tasks.status'
  | 'checklist.edit'
  | 'checklist.status'
  | 'platform.admin';

const FULL: Capability[] = [
  'projects.edit',
  'levels.edit',
  'tasks.edit',
  'tasks.status',
  'checklist.edit',
  'checklist.status',
];

const ROLE_CAPS: Record<Role, Capability[]> = {
  platform_admin: [...FULL, 'platform.admin'],
  owner: [...FULL],
  admin: [...FULL],
  engineer: [...FULL],
  supervisor: ['levels.edit', 'tasks.edit', 'tasks.status', 'checklist.edit', 'checklist.status'],
  warehouse: [],
  worker: ['tasks.status', 'checklist.status'],
  transport: ['tasks.status', 'checklist.status'],
  viewer: [],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPS[role]?.includes(capability) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: 'Administrador de plataforma',
  owner: 'Propietario',
  admin: 'Administrador',
  engineer: 'Ingeniero',
  supervisor: 'Supervisor',
  warehouse: 'Almacen',
  worker: 'Trabajador',
  transport: 'Transporte',
  viewer: 'Solo lectura',
};

export function roleLabel(role?: Role | string | null): string {
  if (!role) return 'Sin rol';
  return ROLE_LABELS[role as Role] ?? role;
}
