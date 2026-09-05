import type { Role } from '@/types/api';

export type Capability =
  | 'projects.edit'
  | 'levels.edit'
  | 'tasks.edit'
  | 'tasks.status'
  | 'checklist.edit'
  | 'checklist.status'
  | 'plans.edit'
  | 'documents.edit'
  | 'documents.approve'
  | 'documents.export'
  | 'inventory.edit'
  | 'inventory.move'
  | 'requirements.edit'
  | 'members.edit'
  | 'platform.admin';

const FULL: Capability[] = [
  'projects.edit',
  'levels.edit',
  'tasks.edit',
  'tasks.status',
  'checklist.edit',
  'checklist.status',
  'plans.edit',
  'documents.edit',
  'documents.approve',
  'documents.export',
  'inventory.move',
  'requirements.edit',
];

// Descargas de documentación aprobada son de lectura: el backend sigue exigiendo membresía de la
// constructora y estado aprobado, pero no convierte la descarga en una aprobación técnica.
const DOCUMENT_READ: Capability[] = ['documents.export'];

const ROLE_CAPS: Record<Role, Capability[]> = {
  platform_admin: [...FULL, 'platform.admin'],
  owner: [...FULL, 'inventory.edit', 'members.edit'],
  admin: [...FULL, 'inventory.edit', 'members.edit'],
  engineer: [...FULL],
  supervisor: [...DOCUMENT_READ, 'levels.edit', 'tasks.edit', 'tasks.status', 'checklist.edit', 'checklist.status', 'plans.edit', 'documents.edit', 'inventory.move', 'requirements.edit'],
  warehouse: [...DOCUMENT_READ, 'inventory.edit', 'inventory.move', 'requirements.edit'],
  worker: [...DOCUMENT_READ, 'tasks.status', 'checklist.status'],
  transport: [...DOCUMENT_READ, 'tasks.status', 'checklist.status'],
  viewer: [...DOCUMENT_READ],
};

const ASSIGNMENT_SCOPED_ROLES = new Set<Role>(['worker', 'transport']);

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPS[role]?.includes(capability) ?? false;
}

export function canForAssignment(
  role: Role | null | undefined,
  capability: Capability,
  assignedUserId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  if (!can(role, capability)) return false;
  if (!role || !ASSIGNMENT_SCOPED_ROLES.has(role)) return true;
  return Boolean(currentUserId && assignedUserId === currentUserId);
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
