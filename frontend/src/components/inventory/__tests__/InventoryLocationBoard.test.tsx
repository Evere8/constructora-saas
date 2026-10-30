import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryItem, InventoryRelocationRequest, Project } from '@/types/api';
import { InventoryLocationBoard } from '../InventoryLocationBoard';

const projects: Project[] = [
  { id: 'project-a', company_id: 'company', name: 'Obra A', status: 'active' },
  { id: 'project-b', company_id: 'company', name: 'Obra B', status: 'active' },
];

const item: InventoryItem = {
  id: 'tool-1',
  company_id: 'company',
  code: 'HERR-001',
  name: 'Taladro',
  item_type: 'tool',
  unit: 'unidad',
  status: 'assigned',
  current_project_id: 'project-a',
  quantity: '1',
  created_at: '2026-10-30T00:00:00Z',
};

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'touch' },
    isPrimary: { value: true },
  });
  fireEvent(target, event);
}

describe('InventoryLocationBoard', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });

  it('requests the responsible-person dialog after a touch drag reaches another worksite', () => {
    const requestMove = vi.fn();
    const { container } = render(
      <InventoryLocationBoard
        items={[item]}
        projects={projects}
        relocations={[]}
        canMove
        onRequestMove={requestMove}
      />,
    );
    const destination = container.querySelector('[data-inventory-destination="project-b"]');
    expect(destination).not.toBeNull();
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => destination),
    });
    const handle = screen.getByRole('button', { name: 'Arrastrar Taladro HERR-001' });
    pointer(handle, 'pointerdown', 10, 10);
    pointer(handle, 'pointermove', 80, 80);
    pointer(handle, 'pointerup', 80, 80);
    expect(requestMove).toHaveBeenCalledOnce();
    expect(requestMove).toHaveBeenCalledWith('tool-1', 'project-b');
  });

  it('keeps an item in its origin and shows the pending destination and assignee', () => {
    const relocation: InventoryRelocationRequest = {
      id: 'relocation',
      company_id: 'company',
      task_id: 'task',
      inventory_item_id: item.id,
      from_project_id: 'project-a',
      to_project_id: 'project-b',
      assigned_user_id: 'person',
      requested_by_user_id: 'owner',
      status: 'pending',
      created_at: '2026-10-30T00:00:00Z',
      updated_at: '2026-10-30T00:00:00Z',
      to_project_name: 'Obra B',
      assigned_user_name: 'Mario López',
    };
    const { container } = render(
      <InventoryLocationBoard
        items={[{ ...item, status: 'relocation_pending' }]}
        projects={projects}
        relocations={[relocation]}
        canMove
        onRequestMove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Aguardando reubicación a Obra B por Mario López/)).toBeVisible();
    expect(container.querySelector('[data-inventory-destination="project-a"]')).toHaveTextContent('Taladro');
    expect(screen.queryByRole('button', { name: /Arrastrar Taladro/ })).not.toBeInTheDocument();
  });
});
