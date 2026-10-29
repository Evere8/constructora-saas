import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PerforationBoard } from '../src/pages/projects/rubros/PerforationBoard';
import { InventoryLocationBoard } from '../src/components/inventory/InventoryLocationBoard';
import type { Project, ProjectRubro, InventoryItem } from '../src/types/api';
import { project, rubro } from './fixture';
import '../src/index.css';

function Fixture() {
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  return <main className="p-4"><h1>Pruebas aisladas: no son datos de producción</h1><PerforationBoard companyId="company-qa" projectId={project.id} rubro={rubro as ProjectRubro} /><div className="mt-6" data-testid="inventory"><InventoryLocationBoard canMove items={[{ id: 'tool-qa', code: 'H-1', name: 'Taladro', quantity: 1, unit: 'unidad', status: 'available', current_project_id: null } as InventoryItem]} projects={[project as Project]} destinations={destinations} onMove={(id, dest) => setDestinations({ ...destinations, [id]: dest })} /></div></main>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><Fixture /></QueryClientProvider></React.StrictMode>);
