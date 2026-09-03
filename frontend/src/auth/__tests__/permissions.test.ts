import { describe, it, expect } from 'vitest';
import { can } from '@/auth/permissions';

describe('permisos por rol', () => {
  it('owner puede editar obras', () => {
    expect(can('owner', 'projects.edit')).toBe(true);
  });

  it('supervisor no edita obras pero si tareas y checklist', () => {
    expect(can('supervisor', 'projects.edit')).toBe(false);
    expect(can('supervisor', 'tasks.edit')).toBe(true);
    expect(can('supervisor', 'checklist.edit')).toBe(true);
  });

  it('worker solo cambia estados', () => {
    expect(can('worker', 'tasks.status')).toBe(true);
    expect(can('worker', 'tasks.edit')).toBe(false);
    expect(can('worker', 'projects.edit')).toBe(false);
  });

  it('viewer no tiene capacidades de escritura', () => {
    expect(can('viewer', 'tasks.status')).toBe(false);
    expect(can('viewer', 'checklist.status')).toBe(false);
  });

  it('platform_admin puede administrar la plataforma', () => {
    expect(can('platform_admin', 'platform.admin')).toBe(true);
  });

  it('rol nulo devuelve false', () => {
    expect(can(null, 'tasks.status')).toBe(false);
    expect(can(undefined, 'projects.edit')).toBe(false);
  });
});
