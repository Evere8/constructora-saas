import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hand,
  Highlighter,
  MapPin,
  Maximize2,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  PencilLine,
  Plus,
  Ruler,
  Settings2,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { rubrosApi } from '@/lib/api/rubros';
import { saveBlob } from '@/lib/api/modules';
import type {
  PerforationChecklistEntry,
  PerforationColor,
  PerforationPoint,
  PerforationWorkspace,
  ProjectRubro,
} from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { annotationAtPoint, canvasPointFromClient, type CanvasPoint } from './perforationGeometry';

type DragState = { pointId: string; pointerId: number; originX: number; originY: number } | null;
type PerforationTool = 'point' | 'pan' | 'note' | 'draw' | 'highlight' | 'straight' | 'erase';
type ActiveInteraction =
  | { kind: 'pan' | 'point' | 'note' | 'erase'; pointerId: number; clientX: number; clientY: number; offsetX: number; offsetY: number; point?: CanvasPoint }
  | { kind: 'draw'; pointerId: number; mode: 'draw' | 'highlight' }
  | { kind: 'straight'; pointerId: number; start: CanvasPoint };

type PinchInteraction = { distance: number; scale: number; canvasX: number; canvasY: number };

const PENCIL_COLORS = ['#f97316', '#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#111827'];
const STROKE_OPTIONS = [
  { value: 2, label: 'Fino' },
  { value: 4, label: 'Medio' },
  { value: 7, label: 'Grueso' },
  { value: 11, label: 'Marcado' },
];

function asNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedCoordinate(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(6));
}

function pointColor(point: PerforationPoint): string {
  return point.status === 'completed' ? '#2563eb' : point.color_hex;
}

function filenameFromHeader(defaultName: string): string {
  return defaultName;
}

function checklistText(color?: PerforationColor): string {
  return (color?.checklist_json ?? []).map((item) => item.title).join('\n');
}

function ColorSettingsDialog({
  open,
  onOpenChange,
  companyId,
  projectId,
  rubro,
  colors,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  companyId: string;
  projectId: string;
  rubro: ProjectRubro;
  colors: PerforationColor[];
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [colorHex, setColorHex] = useState('#ef4444');
  const [steps, setSteps] = useState('Perforado\nVerificar punto');
  const current = colors.find((color) => color.id === editingId) ?? null;

  useEffect(() => {
    if (!open) return;
    if (current) {
      setName(current.name);
      setColorHex(current.color_hex);
      setSteps(checklistText(current));
      return;
    }
    setName('');
    setColorHex('#ef4444');
    setSteps('Perforado\nVerificar punto');
  }, [current, open]);

  const invalidate = () => void queryClient.invalidateQueries({
    queryKey: ['perforation-workspace', companyId, projectId, rubro.id],
  });
  const mutation = useMutation({
    mutationFn: () => {
      const checklist = steps
        .split('\n')
        .map((title, index) => ({ id: `step-${index + 1}`, title: title.trim(), checked: false }))
        .filter((item) => item.title.length > 0);
      const input = { name: name.trim(), color_hex: colorHex, checklist };
      return current
        ? rubrosApi.updatePerforationColor(companyId, projectId, rubro.id, current.id, input)
        : rubrosApi.createPerforationColor(companyId, projectId, rubro.id, input);
    },
    onSuccess: () => {
      toast.success(current ? 'Color actualizado' : 'Color creado');
      setEditingId(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (colorId: string) => rubrosApi.removePerforationColor(companyId, projectId, rubro.id, colorId),
    onSuccess: () => {
      toast.success('Color eliminado');
      setEditingId(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canSave = name.trim().length >= 2 && /^#[0-9a-fA-F]{6}$/.test(colorHex);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar colores y checklist</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Cada color crea su propio checklist para los puntos nuevos. Al terminar todos los checks, el punto se muestra azul.
        </p>
        <div className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-2 rounded-xl border bg-muted/35 p-3">
            <p className="text-sm font-semibold">Colores configurados</p>
            {colors.map((color) => (
              <div key={color.id} className={`flex items-center gap-2 rounded-lg border p-2 ${editingId === color.id ? 'border-primary bg-primary/5' : 'bg-card'}`}>
                <span className="h-5 w-5 rounded-full border" style={{ backgroundColor: color.color_hex }} />
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => setEditingId(color.id)}>{color.name}</button>
                <button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={`Eliminar ${color.name}`} onClick={() => { if (window.confirm(`¿Eliminar el color ${color.name}?`)) remove.mutate(color.id); }}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <Button type="button" className="mt-2 w-full" variant="outline" size="sm" onClick={() => setEditingId(null)}><Plus className="h-4 w-4" /> Nuevo color</Button>
          </div>
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <p className="font-semibold">{current ? `Editar ${current.name}` : 'Nuevo color'}</p>
            <div className="space-y-1.5"><Label htmlFor="point-color-name">Nombre</Label><Input id="point-color-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Perforado y corte de cabos" /></div>
            <div className="space-y-1.5"><Label htmlFor="point-color-value">Color</Label><div className="flex gap-2"><input id="point-color-value" aria-label="Color del punto" className="h-10 w-12 rounded-md border bg-transparent p-1" type="color" value={colorHex} onChange={(event) => setColorHex(event.target.value)} /><Input value={colorHex} onChange={(event) => setColorHex(event.target.value)} /></div></div>
            <div className="space-y-1.5"><Label htmlFor="point-color-checklist">Checklist (un paso por línea)</Label><Textarea id="point-color-checklist" value={steps} onChange={(event) => setSteps(event.target.value)} className="min-h-36" /></div>
            <Button type="button" disabled={!canSave || mutation.isPending} onClick={() => mutation.mutate()}>{current ? 'Guardar color' : 'Agregar color'}</Button>
          </div>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PointInspector({
  point,
  companyId,
  projectId,
  rubro,
  colors,
  canEdit,
  editMode,
  anchorStyle,
  bounds,
  onClose,
  onDelete,
  onToggleEdit,
}: {
  point: PerforationPoint;
  companyId: string;
  projectId: string;
  rubro: ProjectRubro;
  colors: PerforationColor[];
  canEdit: boolean;
  editMode: boolean;
  anchorStyle: CSSProperties;
  bounds: { width: number; height: number };
  onClose: () => void;
  onDelete: () => void;
  onToggleEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState(point.note_text ?? '');
  const [label, setLabel] = useState(point.label ?? '');
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const panelDrag = useRef<{ pointerId: number; clientX: number; clientY: number; left: number; top: number } | null>(null);
  const [manualPosition, setManualPosition] = useState<{ left: number; top: number } | null>(null);
  const refresh = () => void queryClient.invalidateQueries({
    queryKey: ['perforation-workspace', companyId, projectId, rubro.id],
  });
  const save = useMutation({
    mutationFn: () => rubrosApi.updatePerforationPoint(companyId, projectId, rubro.id, point.id, {
      label: label.trim() || null,
      note_text: note.trim() || null,
    }),
    onSuccess: () => { toast.success('Nota del punto guardada'); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const checklist = useMutation({
    mutationFn: (next: PerforationChecklistEntry[]) => rubrosApi.updatePerforationChecklist(companyId, projectId, rubro.id, point.id, next),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const pointUpdate = useMutation({
    mutationFn: (input: { color_id?: string; diameter?: number }) => rubrosApi.updatePerforationPoint(companyId, projectId, rubro.id, point.id, input),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const attachment = useMutation({
    mutationFn: (file: File) => rubrosApi.uploadPerforationAttachment(companyId, projectId, rubro.id, point.id, file),
    onSuccess: () => { toast.success('Archivo de nota cargado'); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const complete = point.status === 'completed';
  const toggleCheck = (entry: PerforationChecklistEntry) => {
    checklist.mutate(point.checklist_json.map((item) => item.id === entry.id ? { ...item, checked: !item.checked } : item));
  };
  const saveChecklist = () => {
    const entries = checklistDraft
      .split('\n')
      .map((title) => title.trim())
      .filter(Boolean)
      .map((title, index) => ({ id: `point-step-${index + 1}`, title, checked: false }));
    checklist.mutate(entries, { onSuccess: () => setChecklistOpen(false) });
  };
  const downloadAttachment = async () => {
    try {
      const blob = await rubrosApi.downloadPerforationAttachment(companyId, projectId, rubro.id, point.id);
      saveBlob(blob, filenameFromHeader(point.note_original_filename || 'nota-del-punto'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo descargar la nota');
    }
  };

  const movePanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = panelDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const width = panelRef.current?.offsetWidth ?? 352;
    const height = panelRef.current?.offsetHeight ?? 400;
    setManualPosition({
      left: Math.max(8, Math.min(bounds.width - width - 8, active.left + event.clientX - active.clientX)),
      top: Math.max(8, Math.min(bounds.height - height - 8, active.top + event.clientY - active.clientY)),
    });
  };
  const endPanelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panelDrag.current?.pointerId !== event.pointerId) return;
    panelDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const panelTop = manualPosition?.top ?? Number(anchorStyle.top ?? 8);

  return (
    <section ref={panelRef} style={{ ...anchorStyle, ...manualPosition, maxHeight: Math.max(80, bounds.height - panelTop - 8) }} className="absolute z-30 w-[min(22rem,calc(100%-1rem))] touch-pan-y overscroll-contain overflow-y-auto rounded-2xl border border-border bg-card p-3 shadow-2xl" onPointerDown={(event) => event.stopPropagation()}>
      <div className="sticky top-0 z-10 flex touch-none cursor-grab items-start justify-between gap-3 rounded-lg bg-card/95 py-1 active:cursor-grabbing" onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest('button')) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        panelDrag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, left: manualPosition?.left ?? Number(anchorStyle.left ?? 8), top: manualPosition?.top ?? Number(anchorStyle.top ?? 8) };
      }} onPointerMove={movePanel} onPointerUp={endPanelDrag} onPointerCancel={endPanelDrag}>
        <div className="min-w-0"><p className="flex items-center gap-2 text-sm font-bold"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: pointColor(point) }} /> Punto {complete ? 'completado' : 'en proceso'}</p><p className="text-xs text-muted-foreground">{complete ? 'Checklist completo: ahora se muestra azul.' : 'Completa los pasos para marcarlo como terminado.'}</p></div>
        <button type="button" aria-label="Cerrar detalle del punto" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground hover:bg-primary hover:text-primary-foreground" onClick={onClose}><X className="h-5 w-5" /></button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><Label>Nombre opcional</Label><Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ej. baño suite" /></div>
        <div className="space-y-1"><Label>Color / tipo</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={point.color_id ?? ''} onChange={(event) => pointUpdate.mutate({ color_id: event.target.value })}>{colors.filter((color) => color.is_active).map((color) => <option key={color.id} value={color.id}>{color.name}</option>)}</select></div>
      </div>
      <div className="mt-3 rounded-xl bg-muted/50 p-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checklist</p>
        <div className="mt-1 space-y-1">
          {point.checklist_json.length ? point.checklist_json.map((entry) => <button key={entry.id} type="button" onClick={() => toggleCheck(entry)} disabled={checklist.isPending} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${entry.checked ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/45 dark:text-blue-100' : 'hover:bg-card'}`}><span className={`grid h-5 w-5 place-items-center rounded border ${entry.checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-muted-foreground/40'}`}>{entry.checked ? <Check className="h-3.5 w-3.5" /> : null}</span><span className={entry.checked ? 'line-through opacity-70' : ''}>{entry.title}</span></button>) : <p className="p-2 text-xs text-muted-foreground">Este color no tiene pasos configurados.</p>}
        </div>
      </div>
      <div className="mt-3 space-y-1"><Label>Nota</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Escribe una observación del punto" className="min-h-20" /></div>
      <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Guardar nota</Button><Button size="sm" variant="outline" onClick={() => { setChecklistDraft(point.checklist_json.map((entry) => entry.title).join('\n')); setChecklistOpen(true); }}><Settings2 className="h-4 w-4" /> Configurar checklist</Button><Button size="sm" variant={editMode ? 'default' : 'outline'} onClick={onToggleEdit}><Pencil className="h-4 w-4" /> {editMode ? 'Terminar edición' : 'Mover / tamaño'}</Button><Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}><Paperclip className="h-4 w-4" /> Cargar nota</Button><input ref={fileInput} className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) attachment.mutate(file); event.target.value = ''; }} /></div>
      {canEdit ? <Button type="button" size="sm" variant="destructive" className="mt-2" onClick={onDelete}><Trash2 className="h-4 w-4" /> Eliminar punto</Button> : null}
      {point.note_original_filename ? <button type="button" className="mt-2 flex max-w-full items-center gap-1 text-xs text-primary underline" onClick={() => void downloadAttachment()}><FileText className="h-3.5 w-3.5" /><span className="truncate">{point.note_original_filename}</span></button> : null}
      {editMode ? <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs"><div className="flex items-center justify-between gap-2"><span>Arrastra el punto o ajusta su tamaño.</span><span>{Math.round(asNumber(point.diameter) * 100)}%</span></div><input className="mt-2 w-full accent-primary" type="range" min="0.8" max="12" step="0.2" value={asNumber(point.diameter) * 100} onChange={(event) => pointUpdate.mutate({ diameter: Number(event.target.value) / 100 })} /></div> : null}
      <Dialog open={checklistOpen} onOpenChange={setChecklistOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Configurar checklist del punto</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Un control por línea. Al guardar se reinicia el estado del punto.</p>
          <Textarea value={checklistDraft} onChange={(event) => setChecklistDraft(event.target.value)} className="min-h-40" placeholder="Perforado\nVerificar punto\nRegistrar evidencia" />
          <DialogFooter><Button type="button" variant="outline" onClick={() => setChecklistOpen(false)}>Cancelar</Button><Button type="button" disabled={checklist.isPending} onClick={saveChecklist}>Guardar checklist</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function PerforationBoard({ companyId, projectId, rubro }: { companyId: string; projectId: string; rubro: ProjectRubro }) {
  const canEdit = useCan('projects.edit');
  const queryClient = useQueryClient();
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<ActiveInteraction | null>(null);
  const activeTouches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<PinchInteraction | null>(null);
  const penActive = useRef(false);
  const suppressPointClickUntil = useRef(0);
  const drawingRef = useRef<CanvasPoint[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [colorSettingsOpen, setColorSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tool, setTool] = useState<PerforationTool>('pan');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [drawing, setDrawing] = useState<CanvasPoint[]>([]);
  const [straightLine, setStraightLine] = useState<{ start: CanvasPoint; end: CanvasPoint } | null>(null);
  const [note, setNote] = useState<{ point: CanvasPoint; text: string } | null>(null);
  const [pencilColor, setPencilColor] = useState('#f97316');
  const [strokeWidth, setStrokeWidth] = useState(4);

  const workspace = useQuery({
    queryKey: ['perforation-workspace', companyId, projectId, rubro.id],
    queryFn: ({ signal }) => rubrosApi.perforationWorkspace(companyId, projectId, rubro.id, signal),
    refetchInterval: 3500,
  });
  const data = workspace.data;
  const documents = data?.documents ?? [];
  const colors = useMemo(() => data?.colors ?? [], [data?.colors]);
  const activeColorId = selectedColorId ?? colors.find((color) => color.is_active)?.id ?? null;
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null;
  const selectedPoint = (data?.points ?? []).find((point) => point.id === selectedPointId) ?? null;
  const filteredPoints = useMemo(() => (data?.points ?? []).filter((point) => point.document_id === selectedDocument?.id && point.page_number === page), [data?.points, page, selectedDocument?.id]);
  const filteredAnnotations = useMemo(() => (data?.annotations ?? []).filter((item) => item.document_id === selectedDocument?.id && item.page_number === page), [data?.annotations, page, selectedDocument?.id]);
  const pointInspectorStyle = useMemo<CSSProperties | undefined>(() => {
    if (!selectedPoint) return undefined;
    const width = viewportSize.width || 650;
    const height = viewportSize.height || 650;
    const panelWidth = Math.min(352, width - 16);
    const panelHeight = Math.min(520, height - 16);
    const x = asNumber(selectedPoint.x) * imageSize.width * scale + offset.x;
    const y = asNumber(selectedPoint.y) * imageSize.height * scale + offset.y;
    return {
      left: Math.max(8, Math.min(width - panelWidth - 8, x + panelWidth + 20 <= width ? x + 12 : x - panelWidth - 12)),
      top: Math.max(8, Math.min(height - panelHeight - 8, y - 80)),
    };
  }, [selectedPoint, viewportSize, imageSize, scale, offset]);
  const noteStyle = useMemo<CSSProperties | undefined>(() => {
    if (!note) return undefined;
    const x = note.point.x * imageSize.width * scale + offset.x;
    const y = note.point.y * imageSize.height * scale + offset.y;
    return {
      left: Math.max(8, Math.min(viewportSize.width - Math.min(240, viewportSize.width - 16) - 8, x + 12)),
      top: Math.max(8, Math.min(viewportSize.height - 100, y + 12)),
    };
  }, [note, imageSize, scale, offset, viewportSize]);

  const constrainOffset = useCallback((next: { x: number; y: number }, nextScale = scale) => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return next;
    const canvasWidth = canvas.offsetWidth || canvas.clientWidth;
    const canvasHeight = canvas.offsetHeight || canvas.clientHeight;
    if (!canvasWidth || !canvasHeight) return next;
    const minX = Math.min(0, viewport.clientWidth - canvasWidth * nextScale);
    const minY = Math.min(0, viewport.clientHeight - canvasHeight * nextScale);
    return {
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    };
  }, [scale]);

  useEffect(() => { offsetRef.current = offset; }, [offset]);

  useEffect(() => {
    if (!selectedDocument) {
      setSelectedDocumentId(null);
      return;
    }
    if (selectedDocument.id !== selectedDocumentId) setSelectedDocumentId(selectedDocument.id);
    if (page > (selectedDocument.page_count ?? 1)) setPage(1);
  }, [page, selectedDocument, selectedDocumentId]);
  useEffect(() => {
    if (!selectedColorId && colors[0]) setSelectedColorId(colors[0].id);
    if (selectedColorId && !colors.some((color) => color.id === selectedColorId && color.is_active)) setSelectedColorId(colors.find((color) => color.is_active)?.id ?? null);
  }, [colors, selectedColorId]);
  useEffect(() => {
    if (selectedPoint && selectedPoint.document_id === selectedDocument?.id && selectedPoint.page_number === page) return;
    setSelectedPointId(null);
    setEditingPointId(null);
  }, [page, selectedDocument?.id, selectedPoint]);
  useEffect(() => {
    interaction.current = null;
    activeTouches.current.clear();
    pinch.current = null;
    setDrawing([]);
    setStraightLine(null);
    setNote(null);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setTool('pan');
  }, [page, selectedDocument?.id]);

  const preview = useQuery({
    queryKey: ['perforation-preview', companyId, projectId, rubro.id, selectedDocument?.id, page],
    queryFn: () => rubrosApi.previewPerforationDocument(companyId, projectId, rubro.id, selectedDocument!.id, page),
    enabled: Boolean(selectedDocument),
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview.data) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(preview.data);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview.data]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setOffset((current) => constrainOffset(current));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [constrainOffset, previewUrl]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return undefined;
    const update = () => {
      const nextViewport = { width: viewport.clientWidth, height: viewport.clientHeight };
      const nextImage = { width: canvas.offsetWidth, height: canvas.offsetHeight };
      setViewportSize((current) => current.width === nextViewport.width && current.height === nextViewport.height ? current : nextViewport);
      setImageSize((current) => current.width === nextImage.width && current.height === nextImage.height ? current : nextImage);
      setOffset((current) => constrainOffset(current));
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(canvas);
    update();
    return () => observer.disconnect();
  }, [previewUrl, isFullscreen, constrainOffset]);

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isFullscreen]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['perforation-workspace', companyId, projectId, rubro.id] });
  const createDocument = useMutation({
    mutationFn: () => rubrosApi.uploadPerforationDocument(companyId, projectId, rubro.id, uploadName.trim(), uploadFile as File),
    onSuccess: (document) => { toast.success('Plano de perforaciones cargado'); setSelectedDocumentId(document.id); setPage(1); setUploadName(''); setUploadFile(null); refresh(); },
    onError: (error: Error & { status?: number }) => toast.error(error.status === 413 ? 'El PDF supera el tamaño permitido por el servidor (50 MB).' : error.message),
  });
  const createPoint = useMutation({
    mutationFn: ({ x, y }: { x: number; y: number }) => rubrosApi.createPerforationPoint(companyId, projectId, rubro.id, {
      document_id: selectedDocument!.id,
      color_id: activeColorId as string,
      page_number: page,
      x,
      y,
    }),
    onSuccess: (point) => { setSelectedPointId(point.id); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const movePoint = useMutation({
    mutationFn: ({ pointId, x, y }: { pointId: string; x: number; y: number }) => rubrosApi.updatePerforationPoint(companyId, projectId, rubro.id, pointId, { x, y }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteDocument = useMutation({
    mutationFn: (documentId: string) => rubrosApi.removePerforationDocument(companyId, projectId, rubro.id, documentId),
    onSuccess: () => { toast.success('Plano eliminado'); setSelectedDocumentId(null); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const deletePoint = useMutation({
    mutationFn: (pointId: string) => rubrosApi.removePerforationPoint(companyId, projectId, rubro.id, pointId),
    onSuccess: () => { toast.success('Punto eliminado'); setSelectedPointId(null); setEditingPointId(null); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const createAnnotation = useMutation({
    mutationFn: (input: Parameters<typeof rubrosApi.createPerforationAnnotation>[3]) => rubrosApi.createPerforationAnnotation(companyId, projectId, rubro.id, input),
    onSuccess: (created) => {
      queryClient.setQueryData<PerforationWorkspace>(['perforation-workspace', companyId, projectId, rubro.id], (current) => current && ({ ...current, annotations: [...current.annotations, created] }));
      refresh();
    },
    onError: (error: Error) => toast.error(`No se guardó la marca: ${error.message}`),
  });
  const deleteAnnotation = useMutation({
    mutationFn: (annotationId: string) => rubrosApi.removePerforationAnnotation(companyId, projectId, rubro.id, annotationId),
    onSuccess: (_, annotationId) => {
      queryClient.setQueryData<PerforationWorkspace>(['perforation-workspace', companyId, projectId, rubro.id], (current) => current && ({ ...current, annotations: current.annotations.filter((item) => item.id !== annotationId) }));
      refresh();
    },
    onError: (error: Error) => toast.error(`No se borró la marca: ${error.message}`),
  });

  const pointFromClient = (clientX: number, clientY: number): CanvasPoint | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? canvasPointFromClient(rect, clientX, clientY) : null;
  };
  const annotationStyle = (mode: 'draw' | 'highlight' | 'straight') => ({
    color_hex: pencilColor,
    stroke_width: mode === 'highlight' ? Math.max(strokeWidth * 3, 14) : strokeWidth,
    opacity: mode === 'highlight' ? 0.32 : 1,
  });
  const saveAnnotation = (kind: 'line' | 'note', points: CanvasPoint[], style: ReturnType<typeof annotationStyle>, text?: string) => {
    if (!selectedDocument) return;
    createAnnotation.mutate({ document_id: selectedDocument.id, page_number: page, kind, points, text, ...style });
  };
  const startPinch = () => {
    const touches = [...activeTouches.current.values()];
    const viewport = viewportRef.current;
    if (touches.length < 2 || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const centerX = (touches[0].x + touches[1].x) / 2 - rect.left;
    const centerY = (touches[0].y + touches[1].y) / 2 - rect.top;
    pinch.current = {
      distance: Math.max(1, Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y)),
      scale,
      canvasX: (centerX - offsetRef.current.x) / scale,
      canvasY: (centerY - offsetRef.current.y) / scale,
    };
    interaction.current = null;
    setDrawing([]);
    setStraightLine(null);
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'touch' && penActive.current) return;
    if (event.pointerType === 'pen') {
      penActive.current = true;
      activeTouches.current.clear();
      pinch.current = null;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouches.current.size >= 2) {
        startPinch();
      } else {
        interaction.current = { kind: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
      }
      return;
    }
    const point = pointFromClient(event.clientX, event.clientY);
    if (tool === 'pan') {
      interaction.current = { kind: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
      return;
    }
    if (!point || !canEdit || !selectedDocument) return;
    if (tool === 'point') {
      if (!activeColorId || drag) return;
      interaction.current = {
        kind: 'point',
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        offsetX: offsetRef.current.x,
        offsetY: offsetRef.current.y,
        point,
      };
      return;
    }
    if (tool === 'note' || tool === 'erase') {
      interaction.current = { kind: tool, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y, point };
      return;
    }
    if (tool === 'draw' || tool === 'highlight') {
      interaction.current = { kind: 'draw', pointerId: event.pointerId, mode: tool };
      drawingRef.current = [point];
      setDrawing([point]);
      return;
    }
    interaction.current = { kind: 'straight', pointerId: event.pointerId, start: point };
    setStraightLine({ start: point, end: point });
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      if (!activeTouches.current.has(event.pointerId)) return;
      activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch.current && activeTouches.current.size >= 2) {
        const touches = [...activeTouches.current.values()];
        const rect = event.currentTarget.getBoundingClientRect();
        const centerX = (touches[0].x + touches[1].x) / 2 - rect.left;
        const centerY = (touches[0].y + touches[1].y) / 2 - rect.top;
        const nextScale = Math.max(1, Math.min(3, pinch.current.scale * Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y) / pinch.current.distance));
        setScale(nextScale);
        setOffset(constrainOffset({ x: centerX - pinch.current.canvasX * nextScale, y: centerY - pinch.current.canvasY * nextScale }, nextScale));
        return;
      }
    }
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === 'point' || active.kind === 'note' || active.kind === 'erase') {
      const distance = Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY);
      if (distance <= 6) return;
      interaction.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        clientX: active.clientX,
        clientY: active.clientY,
        offsetX: active.offsetX,
        offsetY: active.offsetY,
      };
      setOffset(constrainOffset({
        x: active.offsetX + event.clientX - active.clientX,
        y: active.offsetY + event.clientY - active.clientY,
      }));
      return;
    }
    if (active.kind === 'pan') {
      if (Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) > 6) suppressPointClickUntil.current = Date.now() + 300;
      setOffset(constrainOffset({
        x: active.offsetX + event.clientX - active.clientX,
        y: active.offsetY + event.clientY - active.clientY,
      }));
      return;
    }
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    if (active.kind === 'draw') {
      const previous = drawingRef.current[drawingRef.current.length - 1];
      if (!previous || Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y) > 0.002) {
        drawingRef.current = [...drawingRef.current, point];
        setDrawing(drawingRef.current);
      }
      return;
    }
    if (active.kind === 'straight') setStraightLine({ start: active.start, end: point });
  };
  const saveNote = () => {
    if (!note?.text.trim()) return;
    saveAnnotation('note', [note.point], annotationStyle('draw'), note.text.trim());
    setNote(null);
    setTool('pan');
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interaction.current;
    if (event.pointerType === 'pen') penActive.current = false;
    if (event.pointerType === 'touch') {
      activeTouches.current.delete(event.pointerId);
      if (pinch.current) {
        if (activeTouches.current.size < 2) pinch.current = null;
        interaction.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        return;
      }
    }
    if (active?.pointerId === event.pointerId) interaction.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!active || active.pointerId !== event.pointerId || event.pointerType === 'touch') return;
    if (active.kind === 'point') {
      const distance = Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY);
      if (distance <= 8 && active.point && canEdit && selectedDocument && activeColorId && !createPoint.isPending) {
        createPoint.mutate(active.point);
      }
      return;
    }
    if (active.kind === 'note' && active.point && Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) <= 8) {
      setNote({ point: active.point, text: '' });
      return;
    }
    if (active.kind === 'erase' && active.point) {
      const rect = canvasRef.current?.getBoundingClientRect();
      const target = rect && annotationAtPoint(active.point, filteredAnnotations, rect.width, rect.height);
      if (target && !deleteAnnotation.isPending) deleteAnnotation.mutate(target.id);
      return;
    }
    if (active.kind === 'draw') {
      const points = drawingRef.current;
      drawingRef.current = [];
      setDrawing([]);
      if (points.length > 1) saveAnnotation('line', points, annotationStyle(active.mode));
      return;
    }
    if (active.kind === 'straight') {
      const end = pointFromClient(event.clientX, event.clientY);
      setStraightLine(null);
      if (end && (Math.abs(active.start.x - end.x) + Math.abs(active.start.y - end.y) > 0.002)) {
        saveAnnotation('line', [active.start, end], annotationStyle('straight'));
      }
    }
  };
  const pointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'pen') penActive.current = false;
    activeTouches.current.delete(event.pointerId);
    pinch.current = null;
    if (interaction.current?.pointerId === event.pointerId) interaction.current = null;
    drawingRef.current = [];
    setDrawing([]);
    setStraightLine(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, point: PerforationPoint) => {
    // A finger always pans the plan, including when it starts on a circle.
    if (event.pointerType === 'touch') {
      setSelectedPointId(point.id);
      return;
    }
    event.stopPropagation();
    if (!canEdit || editingPointId !== point.id) return;
    if (event.pointerType === 'pen') penActive.current = true;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointId: point.id, pointerId: event.pointerId, originX: asNumber(point.x), originY: asNumber(point.y) });
  };
  const dragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = normalizedCoordinate((event.clientX - rect.left) / rect.width);
    const y = normalizedCoordinate((event.clientY - rect.top) / rect.height);
    const element = document.getElementById(`perforation-point-${drag.pointId}`);
    if (element) { element.style.left = `${x * 100}%`; element.style.top = `${y * 100}%`; }
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.pointerType === 'pen') penActive.current = false;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = normalizedCoordinate((event.clientX - rect.left) / rect.width);
      const y = normalizedCoordinate((event.clientY - rect.top) / rect.height);
      movePoint.mutate({ pointId: drag.pointId, x, y });
    }
    setDrag(null);
  };

  if (workspace.isLoading) return <Card className="surface-solid"><CardContent className="p-6 text-sm text-muted-foreground">Preparando el tablero de perforaciones…</CardContent></Card>;
  if (workspace.isError || !data) return <Card className="surface-solid"><CardContent className="space-y-3 p-6"><p className="font-semibold text-destructive">No se pudo cargar Perforaciones.</p><Button size="sm" variant="outline" onClick={() => void workspace.refetch()}>Reintentar</Button></CardContent></Card>;

  return (
    <div className={isFullscreen ? 'fixed inset-0 z-[70] overflow-hidden bg-background p-0' : 'space-y-4'}>
      <Card className={isFullscreen ? 'surface-glass h-full overflow-hidden rounded-none border-0 shadow-none' : 'surface-glass overflow-hidden'}>
        <CardHeader className={isFullscreen ? 'hidden' : 'flex-row items-start justify-between gap-3 space-y-0'}>
          <div><CardTitle className="text-lg">Plano interactivo de perforaciones</CardTitle><p className="mt-1 text-sm text-muted-foreground">Selecciona un color y toca el PDF para crear un punto. Toca un punto para abrir su checklist; doble toque para moverlo o cambiar su tamaño.</p></div>
          <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => setColorSettingsOpen(true)}><Settings2 className="h-4 w-4" /> Colores</Button>{isFullscreen ? <Button size="sm" onClick={() => setIsFullscreen(false)}><X className="h-4 w-4" /> Salir</Button> : null}</div>
        </CardHeader>
        <CardContent className={isFullscreen ? 'relative h-full p-0' : 'space-y-4'}>
          {!isFullscreen && canEdit ? <div className="grid gap-3 rounded-xl border bg-card/90 p-3 lg:grid-cols-[1fr_1.3fr_auto]"><div className="space-y-1"><Label htmlFor="perforation-file">PDF o imagen</Label><Input id="perforation-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; setUploadFile(file); if (file && !uploadName) setUploadName(file.name.replace(/\.[^.]+$/, '')); }} /></div><div className="space-y-1"><Label htmlFor="perforation-title">Nombre del plano</Label><Input id="perforation-title" value={uploadName} onChange={(event) => setUploadName(event.target.value)} placeholder="Ej. Planta nivel 6" /></div><Button className="self-end" disabled={!uploadFile || uploadName.trim().length < 2 || createDocument.isPending} onClick={() => createDocument.mutate()}><Upload className="h-4 w-4" /> Cargar PDF</Button></div> : null}

          {documents.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center"><FileText className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-semibold">Aún no hay un plano de perforaciones</p><p className="mt-1 text-sm text-muted-foreground">Carga el PDF desde arriba para ubicar puntos, checklist y notas directamente sobre el plano.</p></div> : <>
            <div className={isFullscreen ? 'hidden' : 'flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'}>
              <div className="flex min-w-0 flex-wrap gap-2">{documents.map((document) => <button type="button" key={document.id} onClick={() => { setSelectedDocumentId(document.id); setPage(1); }} className={`rounded-xl border px-3 py-2 text-left text-sm transition ${selectedDocument?.id === document.id ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'bg-card hover:border-primary/50'}`}><span className="block max-w-52 truncate font-semibold">{document.title}</span><span className="text-xs text-muted-foreground">{document.points_completed}/{document.points_total} listos</span></button>)}</div>
              <div className="flex flex-wrap items-center gap-2">{canEdit && selectedDocument ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if (window.confirm(`¿Eliminar ${selectedDocument.title} y todos sus puntos?`)) deleteDocument.mutate(selectedDocument.id); }}><Trash2 className="h-4 w-4" /> Eliminar plano</Button> : null}<Button size="sm" variant="outline" onClick={() => setIsFullscreen((value) => !value)}>{isFullscreen ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}{isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</Button></div>
            </div>
            <div className={isFullscreen ? 'hidden' : 'flex flex-wrap items-center gap-2 rounded-xl border bg-card/85 p-3'}><span className="text-sm font-semibold">Nuevo punto:</span>{colors.filter((color) => color.is_active).map((color) => <button key={color.id} type="button" disabled={!canEdit} onClick={() => { setSelectedColorId(color.id); setTool('point'); }} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${selectedColorId === color.id ? 'border-foreground ring-2 ring-primary/30' : 'hover:border-primary/50'}`}><span className="h-3 w-3 rounded-full" style={{ backgroundColor: color.color_hex }} />{color.name}</button>)}{!colors.length ? <span className="text-sm text-muted-foreground">Configura al menos un color.</span> : null}</div>
            <div className={isFullscreen ? 'hidden' : 'flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/85 p-2 shadow-sm'}>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className={tool === 'point' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('point')} disabled={!canEdit}><MapPin className="h-4 w-4" /> Punto</Button>
                <Button size="sm" variant="outline" className={tool === 'pan' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('pan')}><Hand className="h-4 w-4" /> Mover</Button>
                {canEdit ? <>
                  <Button size="sm" variant="outline" className={tool === 'note' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('note')}><MessageSquarePlus className="h-4 w-4" /> Texto</Button>
                  <Button size="sm" variant="outline" className={tool === 'draw' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('draw')}><PencilLine className="h-4 w-4" /> Lápiz</Button>
                  <Button size="sm" variant="outline" className={tool === 'highlight' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('highlight')}><Highlighter className="h-4 w-4" /> Iluminador</Button>
                  <Button size="sm" variant="outline" className={tool === 'straight' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('straight')}><Ruler className="h-4 w-4" /> Trazo recto</Button>
                  <Button size="sm" variant="outline" className={tool === 'erase' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('erase')}><Trash2 className="h-4 w-4" /> Borrador</Button>
                  <Button size="sm" variant="ghost" disabled={!filteredAnnotations.length || deleteAnnotation.isPending} onClick={() => { const last = filteredAnnotations[filteredAnnotations.length - 1]; if (last) deleteAnnotation.mutate(last.id); }}><Undo2 className="h-4 w-4" /> Deshacer última</Button>
                </> : null}
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" aria-label="Alejar plano" onClick={() => setScale((value) => Math.max(1, value - 0.2))}><ZoomOut className="h-4 w-4" /></Button>
                <span className="w-12 text-center text-xs font-semibold">{Math.round(scale * 100)}%</span>
                <Button size="icon" variant="ghost" aria-label="Acercar plano" onClick={() => setScale((value) => Math.min(3, value + 0.2))}><ZoomIn className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>Restablecer</Button>
              </div>
            </div>
            {!isFullscreen && canEdit && (tool === 'draw' || tool === 'highlight' || tool === 'straight') ? <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/85 px-3 py-2 text-xs"><span className="font-semibold">Color</span>{PENCIL_COLORS.map((color) => <button key={color} type="button" aria-label={`Usar color ${color}`} className={`h-6 w-6 rounded-full border-2 ${pencilColor === color ? 'scale-110 border-slate-900' : 'border-white'}`} style={{ backgroundColor: color }} onClick={() => setPencilColor(color)} />)}<input aria-label="Color personalizado" className="h-7 w-8 cursor-pointer rounded border p-0.5" type="color" value={pencilColor} onChange={(event) => setPencilColor(event.target.value)} /><span className="ml-1 font-semibold">Grosor</span><select aria-label="Grosor del trazo" className="h-8 rounded-md border bg-background px-2 text-xs" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))}>{STROKE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div> : null}
            {!isFullscreen && selectedDocument && (selectedDocument.page_count ?? 1) > 1 ? <div className="flex items-center justify-between rounded-lg border bg-card p-2 text-sm"><Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /> Anterior</Button><span>Página {page} de {selectedDocument.page_count}</span><Button size="sm" variant="ghost" disabled={page >= (selectedDocument.page_count ?? 1)} onClick={() => setPage((value) => value + 1)}>Siguiente <ChevronRight className="h-4 w-4" /></Button></div> : null}
            {!isFullscreen ? <p className="text-xs text-muted-foreground">Dedo: desplazar y pellizcar para ampliar. Lápiz: usar la herramienta elegida sobre el PDF. {createAnnotation.isPending ? 'Guardando marca…' : 'Las marcas guardadas aparecen en otros dispositivos.'}</p> : null}
            <div className={`relative overflow-hidden bg-slate-100 ${isFullscreen ? 'h-full w-full' : 'h-[650px] rounded-2xl shadow-inner'}`}>
              {isFullscreen ? <Button type="button" size="sm" className="absolute right-4 top-4 z-[60] shadow-lg" onClick={() => setIsFullscreen(false)}><X className="h-4 w-4" /> Salir</Button> : null}
              {preview.isLoading ? <div className="grid h-full min-h-[26rem] place-items-center text-sm text-muted-foreground">Preparando vista del PDF…</div> : preview.isError || !previewUrl ? <div className="grid h-full min-h-[26rem] place-items-center text-sm text-destructive">No se pudo mostrar este plano.</div> : <div ref={viewportRef} className="relative h-full w-full touch-none overflow-hidden" onPointerDown={pointerDown} onPointerMove={(event) => { dragMove(event); pointerMove(event); }} onPointerUp={(event) => { endDrag(event); pointerUp(event); }} onPointerCancel={(event) => { setDrag(null); pointerCancel(event); }} onDoubleClick={() => { if (tool === 'pan') setScale((value) => Math.min(3, value * 1.7)); }}>
                <div ref={canvasRef} className="absolute left-0 top-0 w-full select-none" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: '0 0' }}>
                  <img src={previewUrl} alt={`Plano de perforaciones ${selectedDocument.title}`} className="block w-full" draggable={false} onLoad={() => setOffset((current) => constrainOffset(current))} />
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                    {filteredAnnotations.map((annotation) => {
                      if (annotation.kind === 'line' && annotation.points.length > 1) return <polyline key={annotation.id} fill="none" stroke={annotation.color_hex} strokeWidth={annotation.stroke_width} strokeOpacity={asNumber(annotation.opacity)} strokeLinecap="round" strokeLinejoin="round" points={annotation.points.map((point) => `${asNumber(point.x) * 1000},${asNumber(point.y) * 1000}`).join(' ')} />;
                      if (annotation.kind === 'note' && annotation.points[0]) { const x = asNumber(annotation.points[0].x) * 1000; const y = asNumber(annotation.points[0].y) * 1000; return <g key={annotation.id}><rect x={x} y={y} width="220" height="42" rx="8" fill="#ffedd5" stroke={annotation.color_hex} /><text x={x + 10} y={y + 27} fill="#7c2d12" fontSize="18">{(annotation.text || 'Nota').slice(0, 25)}</text></g>; }
                      return null;
                    })}
                    {drawing.length > 1 ? <polyline fill="none" stroke={pencilColor} strokeWidth={tool === 'highlight' ? Math.max(strokeWidth * 3, 14) : strokeWidth} strokeOpacity={tool === 'highlight' ? 0.32 : 1} strokeLinecap="round" strokeLinejoin="round" points={drawing.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')} /> : null}
                    {straightLine ? <line x1={straightLine.start.x * 1000} y1={straightLine.start.y * 1000} x2={straightLine.end.x * 1000} y2={straightLine.end.y * 1000} stroke={pencilColor} strokeWidth={strokeWidth} strokeLinecap="round" /> : null}
                  </svg>
                  {filteredPoints.map((point) => { const diameter = asNumber(point.diameter) * 100; const selected = point.id === selectedPointId; const editing = point.id === editingPointId; return <button id={`perforation-point-${point.id}`} key={point.id} type="button" aria-label={`Punto ${point.label || point.id}`} className={`absolute z-20 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white shadow-lg transition ${selected ? 'ring-4 ring-foreground/25' : ''} ${editing ? 'cursor-grab ring-4 ring-primary/35 active:cursor-grabbing' : 'cursor-pointer'}`} style={{ left: `${asNumber(point.x) * 100}%`, top: `${asNumber(point.y) * 100}%`, width: `${Math.max(16, diameter * 1.9)}px`, height: `${Math.max(16, diameter * 1.9)}px`, backgroundColor: pointColor(point) }} onPointerDown={(event) => beginDrag(event, point)} onClick={(event) => { event.stopPropagation(); if (!drag && Date.now() > suppressPointClickUntil.current) setSelectedPointId(point.id); }} onDoubleClick={(event) => { event.stopPropagation(); setSelectedPointId(point.id); setEditingPointId((id) => id === point.id ? null : point.id); }}><span className="h-1.5 w-1.5 rounded-full bg-white/90" /></button>; })}
                </div>
              </div>}
              {note && noteStyle ? <div className="absolute z-40 w-[min(15rem,calc(100%-1rem))] rounded-xl border bg-card p-2 shadow-xl" style={noteStyle}><Input autoFocus placeholder="Escribe una nota" value={note.text} onChange={(event) => setNote({ ...note, text: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') saveNote(); if (event.key === 'Escape') setNote(null); }} /><div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setNote(null)}>Cancelar</Button><Button size="sm" onClick={saveNote}>Guardar</Button></div></div> : null}
              {selectedPoint && previewUrl && pointInspectorStyle ? <PointInspector key={selectedPoint.id} point={selectedPoint} companyId={companyId} projectId={projectId} rubro={rubro} colors={colors} canEdit={canEdit} editMode={editingPointId === selectedPoint.id} anchorStyle={pointInspectorStyle} bounds={viewportSize} onClose={() => { setSelectedPointId(null); setEditingPointId(null); }} onDelete={() => { if (window.confirm('¿Eliminar este punto?')) deletePoint.mutate(selectedPoint.id); }} onToggleEdit={() => setEditingPointId((id) => id === selectedPoint.id ? null : selectedPoint.id)} /> : null}
            </div>
            <p className={isFullscreen ? 'hidden' : 'text-xs text-muted-foreground'}>Los puntos terminados se muestran en azul. El PDF sigue siendo interactivo en pantalla completa; usa “Salir” o la X para volver.</p>
          </>}
        </CardContent>
      </Card>
      <ColorSettingsDialog open={colorSettingsOpen} onOpenChange={setColorSettingsOpen} companyId={companyId} projectId={projectId} rubro={rubro} colors={colors} />
    </div>
  );
}
