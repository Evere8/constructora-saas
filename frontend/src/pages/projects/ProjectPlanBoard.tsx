import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  GripVertical,
  Hand,
  Highlighter,
  MapPin,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PencilLine,
  RefreshCw,
  Ruler,
  Trash2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan, useCanAssigned } from '@/auth/useCan';
import { checklistApi, type ChecklistInput } from '@/lib/api/checklist';
import { plansApi } from '@/lib/api/modules';
import { projectsApi } from '@/lib/api/projects';
import { asItems } from '@/lib/collection';
import { formatDate } from '@/lib/utils';
import type {
  ChecklistItem,
  ChecklistStatus,
  Level,
  LevelPlanGeometry,
  PlanAnnotation,
  PlanVersion,
  Project,
  ProjectSector,
} from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Point = { x: number; y: number };
type Tool = 'pan' | 'note' | 'draw' | 'highlight' | 'straight' | 'map-level';
type DrawMode = 'draw' | 'highlight';

const BOARD_REFRESH_MS = 2_000;
const PENCIL_COLORS = ['#f97316', '#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#111827'];
const STROKE_OPTIONS = [
  { value: 2, label: 'Fino' },
  { value: 4, label: 'Medio' },
  { value: 7, label: 'Grueso' },
  { value: 11, label: 'Marcado' },
];
const BAND_THICKNESS_OPTIONS = [
  { value: 0.018, label: 'Fino' },
  { value: 0.028, label: 'Medio' },
  { value: 0.04, label: 'Grueso' },
  { value: 0.055, label: 'Muy grueso' },
];

const LEVEL_STATUS = {
  pending: { label: 'Pendiente', color: '#94a3b8', panel: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'En ejecución', color: '#f97316', panel: 'bg-orange-100 text-orange-800' },
  concreted: { label: 'Hormigonado', color: '#16a34a', panel: 'bg-emerald-100 text-emerald-800' },
} as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sectorName(level: Level): string {
  return level.building_name?.trim() || 'Obra general';
}

function asPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return null;
  return { x: clamp(point.x), y: clamp(point.y) };
}

function annotationPoints(annotation: PlanAnnotation): Point[] {
  const points = annotation.geometry_json.points;
  if (!Array.isArray(points)) return [];
  return points.map(asPoint).filter((point): point is Point => point !== null);
}

function annotationPoint(annotation: PlanAnnotation): Point | null {
  return asPoint(annotation.geometry_json);
}

function latestVersions(projectPlans: { versions: PlanVersion[] }[]): PlanVersion[] {
  return projectPlans.flatMap((document) => document.versions);
}

function progressFromStatuses(statuses: string[]): {
  total: number;
  completed: number;
  percent: number;
  status: keyof typeof LEVEL_STATUS;
} {
  const applicable = statuses.filter((status) => status !== 'not_applicable');
  const completed = applicable.filter((status) => status === 'completed').length;
  const total = applicable.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const status =
    total > 0 && completed === total
      ? 'concreted'
      : completed > 0 || applicable.some((item) => item === 'in_progress' || item === 'blocked')
        ? 'in_progress'
        : 'pending';
  return { total, completed, percent, status };
}

function horizontalBandFromPoints(start: Point, end: Point, thickness = 0.028): LevelPlanGeometry | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 0.01 && height < 0.01) return null;
  if (width >= height) {
    const normalizedThickness = clampRange(thickness, 0.012, 0.08);
    const bandY = clamp((start.y + end.y) / 2 - normalizedThickness / 2);
    return {
      x,
      y: Math.min(bandY, 1 - normalizedThickness),
      width: Math.max(width, 0.018),
      height: normalizedThickness,
      band_thickness: normalizedThickness,
    };
  }
  return { x, y, width, height };
}

function rectanglesOverlap(first: LevelPlanGeometry, second: LevelPlanGeometry): boolean {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function keepBandClearOfLevels(
  candidate: LevelPlanGeometry,
  occupied: LevelPlanGeometry[],
): LevelPlanGeometry {
  // Bands placed over different towers may share the same elevation.  Only
  // bands that overlap horizontally are separated, and the closest available
  // row is chosen to preserve the line the user drew.
  if (candidate.width < candidate.height * 2 || !occupied.some((item) => rectanglesOverlap(candidate, item))) {
    return candidate;
  }
  const gap = 0.006;
  const candidates = [candidate.y];
  for (const item of occupied) {
    if (candidate.x >= item.x + item.width || candidate.x + candidate.width <= item.x) continue;
    candidates.push(item.y - candidate.height - gap, item.y + item.height + gap);
  }
  const valid = candidates
    .filter((y) => y >= 0 && y + candidate.height <= 1)
    .map((y) => ({ ...candidate, y }));
  return valid.find((option) => !occupied.some((item) => rectanglesOverlap(option, item)))
    ?? candidate;
}

function snapStraight(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX > absY * 1.8) return { x: end.x, y: start.y };
  if (absY > absX * 1.8) return { x: start.x, y: end.y };
  const distance = Math.max(absX, absY);
  return {
    x: clamp(start.x + Math.sign(dx || 1) * distance),
    y: clamp(start.y + Math.sign(dy || 1) * distance),
  };
}

function getChecklistPosition(geometry: LevelPlanGeometry): Point {
  if (typeof geometry.checklist_x === 'number' && typeof geometry.checklist_y === 'number') {
    return {
      x: clampRange(geometry.checklist_x, 0.02, 0.68),
      y: clampRange(geometry.checklist_y, 0.02, 0.76),
    };
  }
  const beside = geometry.x + geometry.width + 0.02;
  return {
    x: beside <= 0.66 ? beside : clampRange(geometry.x - 0.31, 0.02, 0.66),
    y: clampRange(geometry.y, 0.02, 0.7),
  };
}

function ProgressRing({ value, color, label }: { value: number; color: string; label: string }) {
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80" aria-label={label}>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#e7edf5" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (value / 100) * circumference}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold text-foreground">{value}%</span>
    </div>
  );
}

function BuildingSummary({ levels, sectors }: { levels: Level[]; sectors: ProjectSector[] }) {
  const sectorGroups = useMemo(() => {
    const groups = new Map<string, Level[]>();
    for (const sector of sectors) groups.set(sector.id, []);
    for (const level of levels) {
      const key = level.sector_id || `legacy:${sectorName(level)}`;
      groups.set(key, [...(groups.get(key) ?? []), level]);
    }
    return Array.from(groups.entries()).map(([sectorId, sectorLevels]) => {
      const name = sectors.find((sector) => sector.id === sectorId)?.name
        ?? (sectorLevels[0] ? sectorName(sectorLevels[0]) : 'Obra general');
      return [name, sectorLevels] as const;
    });
  }, [levels, sectors]);

  if (sectorGroups.length === 0) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {sectorGroups.map(([sector, sectorLevels]) => {
        const completed = sectorLevels.filter((level) => level.work_status === 'concreted');
        const inProgress = sectorLevels.some((level) => level.work_status === 'in_progress');
        const percent = sectorLevels.length ? Math.round((completed.length / sectorLevels.length) * 100) : 0;
        const statusKey =
          completed.length === sectorLevels.length && sectorLevels.length > 0
            ? 'concreted'
            : inProgress || completed.length > 0
              ? 'in_progress'
              : 'pending';
        const status = LEVEL_STATUS[statusKey];
        const concretedDates = completed
          .map((level) => level.concreted_at)
          .filter((value): value is string => Boolean(value))
          .sort();
        const lastConcreted = concretedDates[concretedDates.length - 1];

        return (
          <Card key={sector} className="overflow-hidden border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">Sector · {sector}</p>
                  <span className={'mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ' + status.panel}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                    {status.label}
                  </span>
                </div>
                <ProgressRing value={percent} color={status.color} label={'Avance de ' + sector} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-xs">
                <div><p className="text-muted-foreground">Losas</p><p className="mt-0.5 text-base font-semibold">{sectorLevels.length}</p></div>
                <div><p className="text-muted-foreground">Hormig.</p><p className="mt-0.5 text-base font-semibold text-emerald-600">{completed.length}</p></div>
                <div><p className="text-muted-foreground">Restan</p><p className="mt-0.5 text-base font-semibold">{sectorLevels.length - completed.length}</p></div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Último hormigonado: {formatDate(lastConcreted)}</p>
            </CardContent>
          </Card>
        );
      })}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <p className="text-sm font-semibold">Avance en plano</p>
          <div className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            {Object.entries(LEVEL_STATUS).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: value.color }} />
                {value.label}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FloatingLevelChecklist({
  companyId,
  projectId,
  level,
  position,
  getCanvasRect,
  onPersistPosition,
}: {
  companyId: string;
  projectId: string;
  level: Level;
  position: Point;
  getCanvasRect: () => DOMRect | undefined;
  onPersistPosition: (position: Point) => void;
}) {
  const queryClient = useQueryClient();
  const canEditChecklist = useCan('checklist.edit');
  const canChangeStatus = useCanAssigned('checklist.status');
  const [overlayPosition, setOverlayPosition] = useState(position);
  const overlayPositionRef = useRef(position);
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; origin: Point } | null>(null);

  useEffect(() => {
    setOverlayPosition(position);
    overlayPositionRef.current = position;
  }, [level.id]);

  const checklistQuery = useQuery({
    queryKey: ['checklist', companyId, projectId, { level_id: level.id, limit: 200 }],
    queryFn: ({ signal }) => checklistApi.list(companyId, projectId, { level_id: level.id, limit: 200 }, signal),
    refetchInterval: BOARD_REFRESH_MS,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['checklist', companyId, projectId] });
    void queryClient.invalidateQueries({ queryKey: ['checklist-progress', companyId, projectId] });
    void queryClient.invalidateQueries({ queryKey: ['levels', companyId, projectId] });
  };
  const itemMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: Partial<ChecklistInput> }) =>
      checklistApi.update(companyId, projectId, itemId, payload),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const initializeMutation = useMutation({
    mutationFn: () => projectsApi.initializeLevelChecklist(companyId, projectId, level.id),
    onSuccess: () => {
      toast.success('Checklist del nivel preparado');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = asItems(checklistQuery.data);
  const progress = progressFromStatuses(items.map((item) => item.status));
  const displayStatus = LEVEL_STATUS[progress.status];

  const toggleItem = (item: ChecklistItem) => {
    const completed = item.status === 'completed';
    itemMutation.mutate({
      itemId: item.id,
      payload: {
        status: (completed ? 'pending' : 'completed') as ChecklistStatus,
        performed_on: completed ? null : item.performed_on || today(),
      },
    });
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, origin: overlayPosition };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = dragRef.current;
    const rect = getCanvasRect();
    if (!active || active.pointerId !== event.pointerId || !rect) return;
    const next = {
      x: clampRange(active.origin.x + (event.clientX - active.clientX) / rect.width, 0.02, 0.68),
      y: clampRange(active.origin.y + (event.clientY - active.clientY) / rect.height, 0.02, 0.76),
    };
    overlayPositionRef.current = next;
    setOverlayPosition(next);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onPersistPosition(overlayPositionRef.current);
  };

  return (
    <section
      className="absolute z-30 w-[300px] rounded-2xl border border-white/70 bg-white/80 p-3 shadow-xl backdrop-blur-md sm:w-[338px]"
      style={{ left: String(overlayPosition.x * 100) + '%', top: String(overlayPosition.y * 100) + '%' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="inline-flex cursor-grab touch-none items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 active:cursor-grabbing"
          aria-label="Arrastrar checklist"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <GripVertical className="h-3.5 w-3.5" /> Arrastrar para mover
        </button>
        <span className={'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ' + displayStatus.panel}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: displayStatus.color }} />
          {displayStatus.label}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-base font-bold">Checklist · {level.name}</p><p className="truncate text-xs text-muted-foreground">{sectorName(level)}</p></div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">{progress.completed} de {progress.total}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/80">
        <div className="h-full rounded-full transition-all" style={{ width: String(progress.percent) + '%', backgroundColor: displayStatus.color }} />
      </div>
      {checklistQuery.isLoading ? (
        <p className="py-5 text-center text-sm text-muted-foreground">Cargando checklist…</p>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white/50 p-3 text-sm text-muted-foreground">
          <p>Este nivel aún no tiene controles.</p>
          {canEditChecklist ? <Button className="mt-3" size="sm" variant="outline" disabled={initializeMutation.isPending} onClick={() => initializeMutation.mutate()}><RefreshCw className="h-4 w-4" /> Crear checklist</Button> : null}
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {items.map((item) => {
            const completed = item.status === 'completed';
            const canUpdate = canEditChecklist || canChangeStatus(item.assigned_user_id);
            return (
              <button
                key={item.id}
                type="button"
                disabled={!canUpdate || itemMutation.isPending}
                className={'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ' + (completed ? 'bg-emerald-50/85 text-emerald-900' : 'bg-white/55 text-slate-700 hover:bg-white/85')}
                onClick={() => toggleItem(item)}
              >
                <span className={'grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ' + (completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white/70')}>
                  {completed ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                </span>
                <span className={completed ? 'line-through opacity-70' : ''}>{item.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PlanCanvas({
  companyId,
  projectId,
  planUrl,
  version,
  levels,
  annotations,
  selectedLevelId,
  onSelectLevel,
  onCreateAnnotation,
  onSaveLevelGeometry,
  canEdit,
  onDeleteAnnotation,
}: {
  companyId: string;
  projectId: string;
  planUrl: string;
  version: PlanVersion;
  levels: Level[];
  annotations: PlanAnnotation[];
  selectedLevelId: string | null;
  onSelectLevel: (levelId: string) => void;
  onCreateAnnotation: (input: {
    annotation_type: PlanAnnotation['annotation_type'];
    geometry_json: Record<string, unknown>;
    style_json?: Record<string, unknown>;
    comment?: string | null;
    level_id?: string | null;
  }) => void;
  onSaveLevelGeometry: (levelId: string, geometry: LevelPlanGeometry, announce: boolean) => void;
  canEdit: boolean;
  onDeleteAnnotation: (annotationId: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<
    | { kind: 'pan'; clientX: number; clientY: number; offsetX: number; offsetY: number }
    | { kind: 'draw'; mode: DrawMode }
    | { kind: 'straight' }
    | { kind: 'map-level' }
    | null
  >(null);
  const drawingRef = useRef<Point[]>([]);
  const straightRef = useRef<{ start: Point; end: Point } | null>(null);
  const mappingRef = useRef<{ start: Point; end: Point } | null>(null);
  const touchPointers = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const [tool, setTool] = useState<Tool>('pan');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState<Point[]>([]);
  const [drawingMode, setDrawingMode] = useState<DrawMode>('draw');
  const [straightLine, setStraightLine] = useState<{ start: Point; end: Point } | null>(null);
  const [mapping, setMapping] = useState<{ start: Point; end: Point } | null>(null);
  const [note, setNote] = useState<{ point: Point; text: string } | null>(null);
  const [pencilColor, setPencilColor] = useState('#f97316');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [bandThickness, setBandThickness] = useState(0.028);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const mappedLevels = levels.filter((level) => level.plan_version_id === version.id && level.plan_page_number === 1 && level.plan_geometry_json);
  const selectedLevel = levels.find((level) => level.id === selectedLevelId) ?? null;
  const selectedGeometry = selectedLevel?.plan_geometry_json;
  const arrangeMappedBand = (geometry: LevelPlanGeometry): LevelPlanGeometry =>
    keepBandClearOfLevels(
      geometry,
      mappedLevels
        .filter((level) => level.id !== selectedLevelId)
        .map((level) => level.plan_geometry_json as LevelPlanGeometry),
    );

  useEffect(() => {
    const configuredThickness = selectedGeometry?.band_thickness ?? selectedGeometry?.height;
    if (selectedGeometry && configuredThickness && selectedGeometry.width >= selectedGeometry.height * 2) {
      setBandThickness(clampRange(configuredThickness, 0.012, 0.08));
    }
  }, [selectedLevelId, selectedGeometry?.band_thickness, selectedGeometry?.height, selectedGeometry?.width]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): Point | null => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const pointerDistance = (points: Point[]): number => points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  const annotationStyle = (mode: DrawMode | 'straight') => ({
    stroke: pencilColor,
    stroke_width: mode === 'highlight' ? Math.max(strokeWidth * 3, 14) : strokeWidth,
    opacity: mode === 'highlight' ? 0.32 : 1,
    tool: mode,
  });

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pointers = Array.from(touchPointers.current.values());
      if (pointers.length === 2) {
        pinchRef.current = { distance: pointerDistance(pointers), scale };
        interaction.current = null;
        event.preventDefault();
        return;
      }
      const lastTap = lastTapRef.current;
      const now = Date.now();
      if (tool === 'pan' && lastTap && now - lastTap.at < 280 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 36) {
        setScale((value) => Math.min(3, value * 1.7));
        lastTapRef.current = null;
        return;
      }
      lastTapRef.current = { at: now, x: event.clientX, y: event.clientY };
    }
    if (tool === 'pan') {
      interaction.current = { kind: 'pan', clientX: event.clientX, clientY: event.clientY, offsetX: offset.x, offsetY: offset.y };
      return;
    }
    if (!canEdit) return;
    if (tool === 'note') {
      setNote({ point, text: '' });
      return;
    }
    if (tool === 'draw' || tool === 'highlight') {
      const mode: DrawMode = tool === 'highlight' ? 'highlight' : 'draw';
      interaction.current = { kind: 'draw', mode };
      drawingRef.current = [point];
      setDrawing([point]);
      setDrawingMode(mode);
      return;
    }
    if (tool === 'straight') {
      interaction.current = { kind: 'straight' };
      straightRef.current = { start: point, end: point };
      setStraightLine(straightRef.current);
      return;
    }
    if (tool === 'map-level' && selectedLevelId) {
      interaction.current = { kind: 'map-level' };
      mappingRef.current = { start: point, end: point };
      setMapping(mappingRef.current);
    }
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && touchPointers.current.has(event.pointerId)) {
      touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pinch = pinchRef.current;
      if (pinch && touchPointers.current.size >= 2) {
        const distance = pointerDistance(Array.from(touchPointers.current.values()));
        if (distance > 0) setScale(Math.min(3, Math.max(0.65, pinch.scale * (distance / pinch.distance))));
        event.preventDefault();
        return;
      }
    }
    const active = interaction.current;
    if (!active) return;
    if (active.kind === 'pan') {
      setOffset({ x: active.offsetX + event.clientX - active.clientX, y: active.offsetY + event.clientY - active.clientY });
      return;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    if (active.kind === 'draw') {
      const first = drawingRef.current[0];
      if (first && (event.shiftKey || event.ctrlKey || event.metaKey)) {
        drawingRef.current = [first, snapStraight(first, point)];
        setDrawing(drawingRef.current);
        return;
      }
      const last = drawingRef.current[drawingRef.current.length - 1];
      if (!last || Math.abs(last.x - point.x) + Math.abs(last.y - point.y) > 0.002) {
        drawingRef.current = [...drawingRef.current, point];
        setDrawing(drawingRef.current);
      }
    }
    if (active.kind === 'straight' && straightRef.current) {
      straightRef.current = {
        start: straightRef.current.start,
        end: event.shiftKey || event.ctrlKey || event.metaKey ? snapStraight(straightRef.current.start, point) : point,
      };
      setStraightLine(straightRef.current);
    }
    if (active.kind === 'map-level' && mappingRef.current) {
      mappingRef.current = { start: mappingRef.current.start, end: point };
      setMapping(mappingRef.current);
    }
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasPinching = pinchRef.current !== null;
    touchPointers.current.delete(event.pointerId);
    if (touchPointers.current.size < 2) pinchRef.current = null;
    const active = interaction.current;
    interaction.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (wasPinching || !active) return;
    if (active.kind === 'draw') {
      const points = drawingRef.current;
      drawingRef.current = [];
      setDrawing([]);
      if (points.length > 1) onCreateAnnotation({ annotation_type: 'line', geometry_json: { points }, style_json: annotationStyle(active.mode), level_id: selectedLevelId });
    }
    if (active.kind === 'straight' && straightRef.current) {
      const points = [straightRef.current.start, straightRef.current.end];
      straightRef.current = null;
      setStraightLine(null);
      if (Math.abs(points[0].x - points[1].x) + Math.abs(points[0].y - points[1].y) > 0.002) onCreateAnnotation({ annotation_type: 'line', geometry_json: { points }, style_json: annotationStyle('straight'), level_id: selectedLevelId });
    }
    if (active.kind === 'map-level' && selectedLevelId && mappingRef.current) {
      const geometry = horizontalBandFromPoints(mappingRef.current.start, mappingRef.current.end, bandThickness);
      mappingRef.current = null;
      setMapping(null);
      if (geometry) {
        const previousGeometry = selectedLevel?.plan_geometry_json;
        onSaveLevelGeometry(
          selectedLevelId,
          {
            ...arrangeMappedBand(geometry),
            checklist_x: previousGeometry?.checklist_x,
            checklist_y: previousGeometry?.checklist_y,
          },
          true,
        );
        setTool('pan');
      }
    }
  };

  const saveNote = () => {
    if (!note?.text.trim()) return;
    onCreateAnnotation({ annotation_type: 'note', geometry_json: note.point, comment: note.text.trim(), level_id: selectedLevelId });
    setNote(null);
    setTool('pan');
  };

  const rawMappingGeometry = mapping ? horizontalBandFromPoints(mapping.start, mapping.end, bandThickness) : null;
  const mappingGeometry = rawMappingGeometry ? arrangeMappedBand(rawMappingGeometry) : null;
  const previewWidth = drawingMode === 'highlight' ? Math.max(strokeWidth * 3, 14) : strokeWidth;
  const previewOpacity = drawingMode === 'highlight' ? 0.32 : 1;
  const boardClass = isFullscreen ? 'fixed inset-0 z-50 overflow-y-auto bg-slate-50 p-3 sm:p-6' : 'space-y-3';

  return (
    <div className={boardClass}>
      <div className={isFullscreen ? 'mx-auto max-w-[1640px] space-y-3' : 'space-y-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white p-2 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className={tool === 'pan' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('pan')}><Hand className="h-4 w-4" /> Mover</Button>
            {canEdit ? (
              <>
                <Button size="sm" variant="outline" className={tool === 'note' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('note')}><MessageSquarePlus className="h-4 w-4" /> Texto</Button>
                <Button size="sm" variant="outline" className={tool === 'draw' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('draw')}><PencilLine className="h-4 w-4" /> Lápiz</Button>
                <Button size="sm" variant="outline" className={tool === 'highlight' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('highlight')}><Highlighter className="h-4 w-4" /> Iluminador</Button>
                <Button size="sm" variant="outline" className={tool === 'straight' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('straight')}><Ruler className="h-4 w-4" /> Trazo recto</Button>
                <Button size="sm" variant="outline" disabled={!selectedLevelId} className={tool === 'map-level' ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : ''} onClick={() => setTool('map-level')}><MapPin className="h-4 w-4" /> Ubicar nivel</Button>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="Alejar plano" onClick={() => setScale((value) => Math.max(0.65, value - 0.2))}><ZoomOut className="h-4 w-4" /></Button>
            <span className="w-12 text-center text-xs font-semibold">{Math.round(scale * 100)}%</span>
            <Button size="icon" variant="ghost" aria-label="Acercar plano" onClick={() => setScale((value) => Math.min(3, value + 0.2))}><ZoomIn className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>Restablecer</Button>
          </div>
        </div>

        {canEdit && (tool === 'draw' || tool === 'highlight' || tool === 'straight') ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs shadow-sm">
            <span className="font-semibold text-slate-700">Color</span>
            <div className="flex items-center gap-1">
              {PENCIL_COLORS.map((color) => <button key={color} type="button" aria-label={'Usar color ' + color} className={'h-6 w-6 rounded-full border-2 transition ' + (pencilColor === color ? 'scale-110 border-slate-900' : 'border-white')} style={{ backgroundColor: color }} onClick={() => setPencilColor(color)} />)}
              <input aria-label="Color personalizado" className="ml-1 h-7 w-8 cursor-pointer rounded border p-0.5" type="color" value={pencilColor} onChange={(event) => setPencilColor(event.target.value)} />
            </div>
            <span className="ml-1 font-semibold text-slate-700">Grosor</span>
            <select aria-label="Grosor del trazo" className="h-8 rounded-md border bg-white px-2 text-xs" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))}>
              {STROKE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <span className="text-muted-foreground">{tool === 'highlight' ? 'El iluminador queda semitransparente.' : 'Mantén Shift o Ctrl mientras dibujas para trazar recto.'}</span>
          </div>
        ) : null}

        {tool === 'map-level' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
            <span>Traza una línea sobre <strong>{selectedLevel ? sectorName(selectedLevel) + ' · ' + selectedLevel.name : 'el nivel seleccionado'}</strong>. La franja se ajusta para no encimarse con otra del mismo sector.</span>
            <label className="flex items-center gap-2 text-xs font-semibold">Grosor del nivel
              <select className="h-8 rounded-md border border-orange-200 bg-white px-2 text-xs font-normal text-foreground" value={bandThickness} onChange={(event) => setBandThickness(Number(event.target.value))}>
                {BAND_THICKNESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        ) : null}

        <div className={'relative overflow-hidden rounded-2xl border bg-slate-100 shadow-inner ' + (isFullscreen ? 'h-[calc(100vh-158px)] min-h-[560px]' : 'h-[650px]')}>
          <Button className="absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full bg-white/95 shadow-md hover:bg-white" size="sm" variant="secondary" onClick={() => setIsFullscreen((value) => !value)}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}{isFullscreen ? 'Volver' : 'Pantalla completa'}
          </Button>
          <div
            ref={contentRef}
            className="absolute left-0 top-0 w-full touch-none select-none"
            style={{ transform: 'translate(' + String(offset.x) + 'px, ' + String(offset.y) + 'px) scale(' + String(scale) + ')', transformOrigin: '0 0' }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onDoubleClick={() => setScale((value) => Math.min(3, value * 1.7))}
          >
            <img className="block w-full" draggable={false} src={planUrl} alt={'Vista del plano ' + version.original_filename} />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              {mappedLevels.map((level) => {
                const geometry = level.plan_geometry_json as LevelPlanGeometry;
                const status = LEVEL_STATUS[level.work_status];
                const selected = level.id === selectedLevelId;
                const pinOnLeft = geometry.x + geometry.width > 0.68;
                const pinX = pinOnLeft ? Math.max(28, geometry.x * 1000 - 22) : Math.min(972, (geometry.x + geometry.width) * 1000 + 22);
                const pinY = (geometry.y + geometry.height / 2) * 1000;
                const label = level.name.length > 16 ? level.name.slice(0, 15) + '…' : level.name;
                const labelWidth = Math.max(58, Math.min(156, label.length * 10 + 28));
                const labelX = pinOnLeft ? pinX - labelWidth : pinX;
                const textX = pinOnLeft ? pinX - labelWidth / 2 : pinX + labelWidth / 2;
                return (
                  <g
                    key={level.id}
                    className="cursor-pointer"
                    onPointerDown={(event) => {
                      if (tool !== 'pan') return;
                      event.stopPropagation();
                      onSelectLevel(level.id);
                    }}
                  >
                    <rect
                      x={geometry.x * 1000}
                      y={geometry.y * 1000}
                      width={geometry.width * 1000}
                      height={geometry.height * 1000}
                      fill={status.color}
                      fillOpacity={selected ? 0.34 : 0.035}
                      stroke={status.color}
                      strokeOpacity={selected ? 1 : 0.32}
                      strokeWidth={selected ? 8 : 3}
                      rx="4"
                    />
                    {selected ? (
                      <>
                        <path d={'M ' + String((geometry.x + geometry.width / 2) * 1000) + ' ' + String(pinY) + ' L ' + String(pinX) + ' ' + String(pinY)} fill="none" stroke={status.color} strokeWidth="6" strokeLinecap="round" />
                        <rect x={labelX} y={pinY - 20} width={labelWidth} height="40" rx="12" fill={status.color} />
                        <circle cx={pinOnLeft ? labelX + labelWidth - 14 : labelX + 14} cy={pinY} r="7" fill="white" opacity="0.95" />
                        <text x={textX} y={pinY + 6} textAnchor="middle" fill="white" fontSize="18" fontWeight="700" pointerEvents="none">{label}</text>
                      </>
                    ) : null}
                  </g>
                );
              })}
              {annotations.map((annotation) => {
                if (annotation.page_number !== 1 || annotation.status === 'resolved') return null;
                const color = typeof annotation.style_json.stroke === 'string' ? annotation.style_json.stroke : '#f97316';
                const configuredWidth = annotation.style_json.stroke_width;
                const configuredOpacity = annotation.style_json.opacity;
                const lineWidth = typeof configuredWidth === 'number' ? configuredWidth : 4;
                const opacity = typeof configuredOpacity === 'number' ? configuredOpacity : 1;
                if (annotation.annotation_type === 'line') {
                  const points = annotationPoints(annotation);
                  if (points.length < 2) return null;
                  return <polyline key={annotation.id} fill="none" stroke={color} strokeWidth={lineWidth} strokeOpacity={opacity} strokeLinecap="round" strokeLinejoin="round" points={points.map((point) => String(point.x * 1000) + ',' + String(point.y * 1000)).join(' ')} />;
                }
                if (annotation.annotation_type === 'note') {
                  const point = annotationPoint(annotation);
                  if (!point) return null;
                  return <g key={annotation.id}><rect x={point.x * 1000} y={point.y * 1000} width="210" height="38" rx="8" fill="#ffedd5" stroke="#f97316" /><text x={point.x * 1000 + 8} y={point.y * 1000 + 24} fill="#7c2d12" fontSize="18" pointerEvents="none">{(annotation.comment || 'Nota').slice(0, 24)}</text></g>;
                }
                return null;
              })}
              {drawing.length > 1 ? <polyline fill="none" stroke={pencilColor} strokeWidth={previewWidth} strokeOpacity={previewOpacity} strokeLinecap="round" strokeLinejoin="round" points={drawing.map((point) => String(point.x * 1000) + ',' + String(point.y * 1000)).join(' ')} /> : null}
              {straightLine ? <line x1={straightLine.start.x * 1000} y1={straightLine.start.y * 1000} x2={straightLine.end.x * 1000} y2={straightLine.end.y * 1000} stroke={pencilColor} strokeWidth={strokeWidth} strokeLinecap="round" /> : null}
              {mappingGeometry ? <g><rect x={mappingGeometry.x * 1000} y={mappingGeometry.y * 1000} width={mappingGeometry.width * 1000} height={mappingGeometry.height * 1000} fill="#f97316" fillOpacity="0.26" stroke="#f97316" strokeWidth="8" strokeDasharray="14 8" rx="4" /><circle cx={(mappingGeometry.x + mappingGeometry.width / 2) * 1000} cy={(mappingGeometry.y + mappingGeometry.height / 2) * 1000} r="10" fill="#f97316" /></g> : null}
            </svg>
            {selectedLevel && selectedGeometry ? (
              <FloatingLevelChecklist
                key={selectedLevel.id}
                companyId={companyId}
                projectId={projectId}
                level={selectedLevel}
                position={getChecklistPosition(selectedGeometry)}
                getCanvasRect={() => contentRef.current?.getBoundingClientRect()}
                onPersistPosition={(position) => onSaveLevelGeometry(selectedLevel.id, { ...selectedGeometry, checklist_x: position.x, checklist_y: position.y }, false)}
              />
            ) : null}
            {note ? (
              <div className="absolute z-40 w-56 rounded-xl border bg-white/95 p-2 shadow-lg" style={{ left: String(note.point.x * 100) + '%', top: String(note.point.y * 100) + '%' }} onPointerDown={(event) => event.stopPropagation()}>
                <Input autoFocus placeholder="Escribe una nota" value={note.text} onChange={(event) => setNote({ ...note, text: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') saveNote(); if (event.key === 'Escape') setNote(null); }} />
                <div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setNote(null)}>Cancelar</Button><Button size="sm" onClick={saveNote}>Guardar</Button></div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>Plano protegido · los cambios se sincronizan automáticamente con los usuarios activos.</span><span>{annotations.length} anotación(es)</span></div>
        {annotations.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {annotations.slice(-6).map((annotation) => (
              <div key={annotation.id} className="flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs shadow-sm">
                <span>{annotation.annotation_type === 'line' ? annotation.style_json.tool === 'highlight' ? 'Iluminador' : annotation.style_json.tool === 'straight' ? 'Trazo recto' : 'Dibujo' : annotation.comment || 'Nota'}</span>
                {canEdit ? <button className="rounded p-0.5 text-muted-foreground hover:text-destructive" aria-label="Eliminar anotación" onClick={() => onDeleteAnnotation(annotation.id)}><Trash2 className="h-3.5 w-3.5" /></button> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectPlanBoard({ companyId, project }: { companyId: string; project: Project }) {
  const queryClient = useQueryClient();
  const canEditPlan = useCan('plans.edit');
  const plansQuery = useQuery({
    queryKey: ['plans', companyId, project.id],
    queryFn: ({ signal }) => plansApi.list(companyId, project.id, signal),
  });
  const levelsQuery = useQuery({
    queryKey: ['levels', companyId, project.id],
    queryFn: ({ signal }) => projectsApi.listLevels(companyId, project.id, signal),
    refetchInterval: BOARD_REFRESH_MS,
  });
  const sectorsQuery = useQuery({
    queryKey: ['project-sectors', companyId, project.id],
    queryFn: ({ signal }) => projectsApi.listSectors(companyId, project.id, signal),
    refetchInterval: BOARD_REFRESH_MS,
  });
  const plans = plansQuery.data ?? [];
  const levels = [...asItems(levelsQuery.data)].sort((left, right) => sectorName(left).localeCompare(sectorName(right)) || left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  const sectors = [...(sectorsQuery.data ?? [])].sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  const versions = latestVersions(plans);
  const version = versions.find((item) => item.id === project.overview_plan_version_id) ?? versions[0] ?? null;
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedLevelId && levels.some((level) => level.id === selectedLevelId)) return;
    setSelectedLevelId(levels[0]?.id ?? null);
  }, [levels, selectedLevelId]);

  const previewQuery = useQuery({
    queryKey: ['plan-preview', companyId, project.id, version?.id],
    queryFn: () => plansApi.preview(companyId, project.id, version!.id),
    enabled: Boolean(version),
  });
  const [planUrl, setPlanUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewQuery.data) {
      setPlanUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(previewQuery.data);
    setPlanUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewQuery.data]);

  const annotationsQuery = useQuery({
    queryKey: ['plan-annotations', companyId, project.id, version?.id],
    queryFn: ({ signal }) => plansApi.listAnnotations(companyId, project.id, version!.id, signal),
    enabled: Boolean(version),
    refetchInterval: BOARD_REFRESH_MS,
  });
  const invalidateBoard = () => {
    void queryClient.invalidateQueries({ queryKey: ['plan-annotations', companyId, project.id] });
    void queryClient.invalidateQueries({ queryKey: ['levels', companyId, project.id] });
    void queryClient.invalidateQueries({ queryKey: ['project-sectors', companyId, project.id] });
    void queryClient.invalidateQueries({ queryKey: ['project', companyId, project.id] });
  };
  const annotationMutation = useMutation({
    mutationFn: ({ versionId, input }: { versionId: string; input: Parameters<typeof plansApi.createAnnotation>[3] }) => plansApi.createAnnotation(companyId, project.id, versionId, input),
    onSuccess: invalidateBoard,
    onError: (error: Error) => toast.error(error.message),
  });
  const geometryMutation = useMutation({
    mutationFn: ({ levelId, versionId, geometry }: { levelId: string; versionId: string; geometry: LevelPlanGeometry; announce: boolean }) =>
      projectsApi.updateLevel(companyId, project.id, levelId, { plan_version_id: versionId, plan_page_number: 1, plan_geometry_json: geometry }),
    onSuccess: (_level, variables) => {
      if (variables.announce) toast.success('Nivel ubicado y marcado en el plano');
      invalidateBoard();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const detectLevelsMutation = useMutation({
    mutationFn: (versionId: string) => plansApi.detectLevels(companyId, project.id, versionId),
    onSuccess: (result) => {
      toast.success(result.message);
      invalidateBoard();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteAnnotationMutation = useMutation({
    mutationFn: (annotationId: string) => plansApi.deleteAnnotation(companyId, project.id, annotationId),
    onSuccess: invalidateBoard,
    onError: (error: Error) => toast.error(error.message),
  });

  if (plansQuery.isLoading || levelsQuery.isLoading || sectorsQuery.isLoading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Preparando tablero de obra…</CardContent></Card>;
  if (!version) {
    return <Card><CardContent className="space-y-2 p-6 text-sm text-muted-foreground"><p className="text-base font-semibold text-foreground">Tablero de obra</p><p>Para usar el resumen visual, carga un PDF o una imagen desde la pestaña <strong>Planos</strong>.</p><p>Luego pulsa <strong>Mostrar en resumen</strong> en la versión que quieres compartir con el equipo.</p></CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="text-xl font-bold tracking-tight">Plano operativo</h2><p className="text-sm text-muted-foreground">{version.original_filename} · seguimiento visual de avance por sector</p></div>
        {canEditPlan ? <Button size="sm" variant="outline" disabled={levels.length === 0 || detectLevelsMutation.isPending} onClick={() => detectLevelsMutation.mutate(version.id)}>{detectLevelsMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Detectar niveles del PDF</Button> : null}
      </div>
      <BuildingSummary levels={levels} sectors={sectors} />
      <div className="rounded-xl border bg-white p-2 shadow-sm">
        <div className="flex flex-wrap gap-1.5">
          {levels.map((level) => {
            const active = selectedLevelId === level.id;
            const status = LEVEL_STATUS[level.work_status];
            return <Button key={level.id} size="sm" variant="outline" className={'h-auto min-h-9 whitespace-normal py-2 text-left ' + (active ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600 hover:text-white' : 'border-slate-200 bg-white hover:border-orange-300')} onClick={() => setSelectedLevelId(level.id)}><span>{sectorName(level)} · {level.name}</span><span className="ml-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-white/50" style={{ backgroundColor: active ? '#ffffff' : status.color }} /></Button>;
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Selecciona un nivel y usa <strong>Ubicar nivel</strong> para dibujar su borde en el PDF. El trazo se transforma en una franja visible con pin; el checklist se mueve desde su encabezado.</p>
      {previewQuery.isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Preparando la vista privada del plano…</CardContent></Card>
      ) : previewQuery.isError || !planUrl ? (
        <Card><CardContent className="p-6 text-sm text-destructive">No se pudo mostrar este plano. Verifica su archivo desde Planos.</CardContent></Card>
      ) : (
        <PlanCanvas
          companyId={companyId}
          projectId={project.id}
          planUrl={planUrl}
          version={version}
          levels={levels}
          annotations={annotationsQuery.data ?? []}
          selectedLevelId={selectedLevelId}
          onSelectLevel={setSelectedLevelId}
          canEdit={canEditPlan}
          onCreateAnnotation={(input) => annotationMutation.mutate({ versionId: version.id, input: { page_number: 1, ...input } })}
          onSaveLevelGeometry={(levelId, geometry, announce) => geometryMutation.mutate({ levelId, versionId: version.id, geometry, announce })}
          onDeleteAnnotation={(annotationId) => deleteAnnotationMutation.mutate(annotationId)}
        />
      )}
    </div>
  );
}
