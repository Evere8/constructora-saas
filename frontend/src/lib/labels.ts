import type { ProjectStatus, TaskStatus, TaskPriority, ChecklistStatus, TaskType } from '@/types/api';

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info'
  | 'muted';

interface LabelInfo {
  label: string;
  variant: BadgeVariant;
}

export const PROJECT_STATUS: Record<ProjectStatus, LabelInfo> = {
  active: { label: 'Activa', variant: 'success' },
  inactive: { label: 'Inactiva', variant: 'muted' },
  completed: { label: 'Completada', variant: 'info' },
  archived: { label: 'Archivada', variant: 'secondary' },
};

export const TASK_STATUS: Record<TaskStatus, LabelInfo> = {
  pending: { label: 'Pendiente', variant: 'muted' },
  in_progress: { label: 'En progreso', variant: 'warning' },
  review: { label: 'En revision', variant: 'info' },
  completed: { label: 'Completada', variant: 'success' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
};

export const TASK_PRIORITY: Record<TaskPriority, LabelInfo> = {
  low: { label: 'Baja', variant: 'muted' },
  normal: { label: 'Normal', variant: 'secondary' },
  high: { label: 'Alta', variant: 'warning' },
  urgent: { label: 'Urgente', variant: 'destructive' },
};

export const TASK_TYPE: Record<TaskType, string> = {
  work: 'Trabajo',
  transport: 'Transporte',
};

export const CHECKLIST_STATUS: Record<ChecklistStatus, LabelInfo> = {
  pending: { label: 'Pendiente', variant: 'muted' },
  in_progress: { label: 'En progreso', variant: 'warning' },
  blocked: { label: 'Bloqueado', variant: 'destructive' },
  completed: { label: 'Completado', variant: 'success' },
  not_applicable: { label: 'No aplica', variant: 'outline' },
};

export const PROJECT_STATUS_OPTIONS = Object.entries(PROJECT_STATUS).map(([value, info]) => ({
  value: value as ProjectStatus,
  label: info.label,
}));

export const TASK_STATUS_OPTIONS = Object.entries(TASK_STATUS).map(([value, info]) => ({
  value: value as TaskStatus,
  label: info.label,
}));

export const TASK_PRIORITY_OPTIONS = Object.entries(TASK_PRIORITY).map(([value, info]) => ({
  value: value as TaskPriority,
  label: info.label,
}));

export const TASK_TYPE_OPTIONS = Object.entries(TASK_TYPE).map(([value, label]) => ({
  value: value as TaskType,
  label,
}));

export const CHECKLIST_STATUS_OPTIONS = Object.entries(CHECKLIST_STATUS).map(([value, info]) => ({
  value: value as ChecklistStatus,
  label: info.label,
}));
