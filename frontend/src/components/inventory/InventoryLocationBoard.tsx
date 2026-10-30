import { useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import type { InventoryItem, InventoryRelocationRequest, Project } from '@/types/api';
import { Card, CardContent } from '@/components/ui/card';

export function InventoryLocationBoard({ items, projects, relocations, canMove, onRequestMove }: {
  items: InventoryItem[];
  projects: Project[];
  relocations: InventoryRelocationRequest[];
  canMove: boolean;
  onRequestMove: (id: string, destination: string) => void;
}) {
  const drag = useRef<{ id: string; pointer: number; x: number; y: number; moved: boolean } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const active = projects.filter((project) => project.status === 'active');
  const occupied = new Set(items.map((item) => item.current_project_id));
  const columns = [...projects.filter((project) => project.status === 'active' || occupied.has(project.id)), { id: 'warehouse', name: 'Depósito', status: 'active' as const }];
  const activeRelocations = new Map(relocations.map((request) => [request.inventory_item_id, request]));
  const destinationAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-inventory-destination]')?.dataset.inventoryDestination ?? null;

  return <div className="space-y-2">
    <p className="text-xs text-muted-foreground">Arrastra desde el asa ⠿ hacia una obra. Al soltar, el sistema pedirá el responsable y creará su tarea. La ubicación real recién cambia cuando esa persona marca el traslado como terminado.</p>
    <div aria-live="polite" className="text-sm">{dragging ? `Moviendo ${items.find((item) => item.id === dragging)?.name}. Suelta sobre la obra de destino.` : null}</div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{columns.map((project) => {
      const contents = items.filter((item) => (item.current_project_id ?? 'warehouse') === project.id);
      const canReceive = project.id !== 'warehouse' && project.status === 'active';
      return <Card key={project.id} data-inventory-destination={canReceive ? project.id : undefined} className={over === project.id ? 'border-primary bg-primary/10 ring-2 ring-primary' : ''}>
        <CardContent className="space-y-3 p-4">
          <h3 className="font-semibold">{project.name} <span className="text-xs text-muted-foreground">({contents.length}){project.status !== 'active' ? ' · No activa' : ''}</span></h3>
          <div className="min-h-24 max-h-96 space-y-2 overflow-y-auto">{contents.map((item) => {
            const relocation = activeRelocations.get(item.id);
            const movable = canMove && !relocation && !['relocation_pending', 'in_transit', 'maintenance', 'retired'].includes(item.status);
            return <div key={item.id} className={`rounded-lg border bg-background p-2 ${dragging === item.id ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2">
                {movable ? <button type="button" aria-label={`Arrastrar ${item.name} ${item.code}`} className="touch-none cursor-grab rounded p-2 active:cursor-grabbing" onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = { id: item.id, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
                }} onPointerMove={(event) => {
                  const current = drag.current;
                  if (!current || current.pointer !== event.pointerId) return;
                  current.moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8;
                  if (current.moved) { setDragging(item.id); setOver(destinationAt(event.clientX, event.clientY)); }
                }} onPointerUp={(event) => {
                  const current = drag.current;
                  if (!current || current.pointer !== event.pointerId) return;
                  const target = destinationAt(event.clientX, event.clientY);
                  if (current.moved && target && target !== (item.current_project_id ?? 'warehouse')) onRequestMove(current.id, target);
                  drag.current = null; setDragging(null); setOver(null);
                }} onPointerCancel={() => { drag.current = null; setDragging(null); setOver(null); }}><GripVertical className="h-5 w-5" /></button> : null}
                <div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.code} · {item.quantity} {item.unit}{item.serial_number ? ` · ${item.serial_number}` : ''}</p></div>
              </div>
              {relocation ? <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700">Aguardando reubicación a {relocation.to_project_name ?? 'la obra destino'} por {relocation.assigned_user_name ?? 'el responsable asignado'}{relocation.status === 'in_transit' ? ' · En traslado' : ''}</p> : movable ? <select className="mt-2 h-9 w-full rounded border bg-background px-2 text-sm" aria-label={`Solicitar destino de ${item.name} ${item.code}`} value="" onChange={(event) => { if (event.target.value) onRequestMove(item.id, event.target.value); }}><option value="">Solicitar traslado a…</option>{active.filter((target) => target.id !== item.current_project_id).map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select> : <p className="mt-2 text-xs text-muted-foreground">Movimiento no habilitado · {item.status}</p>}
            </div>;
          })}{!contents.length ? <p className="text-xs text-muted-foreground">Sin elementos. Suelta aquí para solicitar una reubicación.</p> : null}</div>
        </CardContent>
      </Card>;
    })}</div>
  </div>;
}
