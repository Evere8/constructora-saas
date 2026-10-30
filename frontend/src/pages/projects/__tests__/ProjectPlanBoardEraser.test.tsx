import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { PlanAnnotation, PlanVersion } from '@/types/api';
import { PlanCanvas } from '../ProjectPlanBoard';

const version: PlanVersion = {
  id: 'version',
  document_id: 'document',
  version_number: 1,
  original_filename: 'obra.pdf',
  mime_type: 'application/pdf',
  size_bytes: 10,
  sha256: 'a'.repeat(64),
  created_by_user_id: 'user',
  created_at: '2026-10-30T00:00:00Z',
};

const annotation: PlanAnnotation = {
  id: 'annotation',
  company_id: 'company',
  plan_version_id: version.id,
  page_number: 1,
  annotation_type: 'line',
  geometry_json: { points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }] },
  style_json: { stroke: '#f97316', stroke_width: 4 },
  status: 'pending',
  created_by_user_id: 'user',
  created_at: '2026-10-30T00:00:00Z',
  updated_at: '2026-10-30T00:00:00Z',
};

it('shows the eraser and deletes the touched saved annotation', () => {
  const remove = vi.fn();
  const { container } = render(
    <PlanCanvas
      companyId="company"
      projectId="project"
      planUrl="data:image/png;base64,AA=="
      version={version}
      levels={[]}
      annotations={[annotation]}
      selectedLevelId={null}
      onSelectLevel={vi.fn()}
      onCreateAnnotation={vi.fn()}
      onSaveLevelGeometry={vi.fn()}
      canEdit
      onDeleteAnnotation={remove}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Borrador' }));
  const hitTarget = container.querySelector('polyline[stroke="transparent"]');
  expect(hitTarget).not.toBeNull();
  fireEvent.pointerDown(hitTarget as SVGPolylineElement, { pointerId: 1 });
  expect(remove).toHaveBeenCalledWith('annotation');
});
