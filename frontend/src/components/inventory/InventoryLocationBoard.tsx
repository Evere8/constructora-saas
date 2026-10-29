import { useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import type { InventoryItem, Project } from '@/types/api';
import { Card, CardContent } from '@/components/ui/card';

export function InventoryLocationBoard({ items, projects, destinations, canMove, onMove }: {
  items: InventoryItem[]; projects: Project[]; destinations: Record<string, string>;
  canMove: boolean; onMove: (id: string, destination: string) => void;
}) {
  const drag = useRef<{ id: string; pointer: number; x: number; y: number; moved: boolean } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const active = projects.filter((project) => project.status === 'active');
  const occupied = new Set(items.map((item) => destinations[item.id] ?? item.current_project_id));
  const columns = [...projects.filter((project) => project.status === 'active' || occupied.has(project.id)), { id: 'warehouse', name: 'Depósito', status: 'active' }];
  const destinationAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-inventory-destination]')?.dataset.inventoryDestination ?? null;
  return <div className="space-y-2"><p className="text-xs text-muted-foreground">Arrastra desde el asa ⠿ con el dedo, lápiz o ratón; también puedes elegir el destino en la lista. Los cambios se confirman con Registrar movimientos. Los materiales se trasladan por lote completo; registra lotes separados para repartirlos.</p><div aria-live="polite" className="text-sm">{dragging ? `Moviendo ${items.find((item) => item.id === dragging)?.name}. Suelta sobre una obra o Depósito.` : null}</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{columns.map((project) => {
    const contents = items.filter((item) => (destinations[item.id] ?? item.current_project_id ?? 'warehouse') === project.id);
    return <Card key={project.id} data-inventory-destination={project.status === 'active' ? project.id : undefined} className={over === project.id ? 'border-primary bg-primary/10 ring-2 ring-primary' : ''}><CardContent className="space-y-3 p-4"><h3 className="font-semibold">{project.name} <span className="text-xs text-muted-foreground">({contents.length}){project.status !== 'active' ? ' · No activa' : ''}</span></h3><div className="min-h-24 max-h-96 space-y-2 overflow-y-auto">{contents.map((item) => {
      const movable = canMove && !['relocation_pending', 'in_transit', 'maintenance', 'retired'].includes(item.status);
      return <div key={item.id} className={`rounded-lg border bg-background p-2 ${dragging === item.id ? 'opacity-50' : ''}`}><div className="flex items-center gap-2">{movable ? <button type="button" aria-label={`Arrastrar ${item.name} ${item.code}`} className="touch-none cursor-grab rounded p-2 active:cursor-grabbing" onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
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
        if (current.moved && target) onMove(current.id, target);
        drag.current = null; setDragging(null); setOver(null);
      }} onPointerCancel={() => { drag.current = null; setDragging(null); setOver(null); }}><GripVertical className="h-5 w-5" /></button> : null}<div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.code} · {item.quantity} {item.unit}{item.serial_number ? ` · ${item.serial_number}` : ''}</p></div></div>{movable ? <select className="mt-2 h-9 w-full rounded border bg-background px-2 text-sm" aria-label={`Destino de ${item.name} ${item.code}`} value={destinations[item.id] ?? item.current_project_id ?? 'warehouse'} onChange={(event) => onMove(item.id, event.target.value)}><option value="warehouse">Depósito</option>{item.current_project_id && !active.some((p) => p.id === item.current_project_id) ? <option value={item.current_project_id} disabled>Ubicación actual (obra no activa)</option> : null}{active.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select> : <p className="text-xs text-muted-foreground">Movimiento no habilitado · {item.status}</p>}</div>;
    })}{!contents.length ? <p className="text-xs text-muted-foreground">Sin elementos. Suelta aquí para asignar.</p> : null}</div></CardContent></Card>;
  })}</div></div>;
}
