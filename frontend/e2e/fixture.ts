// Synthetic, non-production data. Only served by e2e/vite.config.ts.
export const rubro = { id: 'rubro-qa', name: 'Reparaciones' };
export const project = { id: 'project-qa', name: 'Obra QA', status: 'active' };
export function initialWorkspace() {
  return {
    rubro,
    colors: [{ id: 'color-qa', name: 'Perforado', color_hex: '#ef4444', is_active: true, sort_order: 0, checklist_json: [{ id: 'one', title: 'Verificar', checked: false }] }],
    documents: [{ id: 'document-qa', title: 'Nivel QA', original_filename: 'QA.pdf', mime_type: 'application/pdf', size_bytes: 100, page_count: 1, points_total: 0, points_completed: 0 }],
    points: [], annotations: [],
  };
}
