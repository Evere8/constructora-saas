import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Hand,
  MessageSquarePlus,
  PencilLine,
  RefreshCw,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan, useCanAssigned } from '@/auth/useCan';
import { checklistApi, type ChecklistInput } from '@/lib/api/checklist';
import { plansApi } from '@/lib/api/modules';
import { projectsApi, type LevelInput } from '@/lib/api/projects';
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
} from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Point = { x: number; y: number };
type Tool = 'pan' | 'note' | 'draw' | 'map-level';

const BOARD_REFRESH_MS = 2_000;

const LEVEL_STATUS = {
  pending: { label: 'Pendiente', color: '#94a3b8', className: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'En ejecución', color: '#f59e0b', className: 'bg-amber-100 text-amber-800' },
  concreted: { label: 'Hormigonado', color: '#16a34a', className: 'bg-emerald-100 text-emerald-800' },
} as const;

const today = () => new Date().toISOString().slice(0, 10);

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function geometryFromPoints(start: Point, end: Point): LevelPlanGeometry | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 0.01 || height < 0.01) return null;
  return { x, y, width, height };
}

function asPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return null;
  return { x: clamp(candidate.x), y: clamp(candidate.y) };
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

function LevelStatusBadge({ level }: { level: Level }) {
  const status = LEVEL_STATUS[level.work_status];
  return <Badge className={status.className}>{status.label}</Badge>;
}

function BuildingSummary({ levels }: { levels: Level[] }) {
  const groups = useMemo(() => {
    const result = new Map<string, Level[]>();
    for (const level of levels) {
      const key = level.building_name?.trim() || 'Obra general';
      result.set(key, [...(result.get(key) ?? []), level]);
    }
    return Array.from(result.entries());
  }, [levels]);

  if (groups.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map(([building, buildingLevels]) => {
        const concreted = buildingLevels.filter((level) => level.work_status === 'concreted');
        const latest = concreted
          .map((level) => level.concreted_at)
          .filter((value): value is string => Boolean(value))
          .sort();
        const latestConcreted = latest[latest.length - 1];
        return (
          <Card key={building} className="border-primary/15">
            <CardContent className="space-y-1.5 p-4">
              <p className="font-medium">{building}</p>
              <p className="text-sm text-muted-foreground">Total de losas: {buildingLevels.length}</p>
              <p className="text-sm text-muted-foreground">Losas hormigonadas: {concreted.length}</p>
              <p className="text-sm text-muted-foreground">Losas restantes: {buildingLevels.length - concreted.length}</p>
              <p className="pt-1 text-xs text-muted-foreground">Último hormigonado: {formatDate(latestConcreted)}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function LevelChecklistCard({
  companyId,
  projectId,
  level,
}: {
  companyId: string;
  projectId: string;
  level: Level;
}) {
  const queryClient = useQueryClient();
  const canEditChecklist = useCan('checklist.edit');
  const canChangeStatus = useCanAssigned('checklist.status');
  const canEditLevel = useCan('levels.edit');
  const checklistQuery = useQuery({
    queryKey: ['checklist', companyId, projectId, { level_id: level.id, limit: 200 }],
    queryFn: ({ signal }) => checklistApi.list(companyId, projectId, { level_id: level.id, limit: 200 }, signal),
    refetchInterval: BOARD_REFRESH_MS,
  });
  const tasksQuery = useQuery({
    queryKey: ['tasks', companyId, projectId, { level_id: level.id, limit: 100 }],
    queryFn: ({ signal }) => projectsApi.listTasks(companyId, projectId, { level_id: level.id, limit: 100 }, signal),
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
  const levelMutation = useMutation({
    mutationFn: (payload: Partial<LevelInput>) => projectsApi.updateLevel(companyId, projectId, level.id, payload),
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
  const assignedPeople = new Set(
    asItems(tasksQuery.data)
      .map((task) => task.assigned_user_id)
      .filter((value): value is string => Boolean(value)),
  ).size;

  const toggleItem = (item: ChecklistItem, checked: boolean) => {
    itemMutation.mutate({
      itemId: item.id,
      payload: {
        status: (checked ? 'completed' : 'pending') as ChecklistStatus,
        performed_on: checked ? item.performed_on || today() : null,
      },
    });
  };

  return (
    <Card>
      <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Checklist · {level.name}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {level.building_name || 'Obra general'} · Personal asignado: {assignedPeople}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditLevel ? (
            <>
              <select
                aria-label="Estado del nivel"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={level.work_status}
                onChange={(event) => {
                  const workStatus = event.target.value as Level['work_status'];
                  levelMutation.mutate({
                    work_status: workStatus,
                    concreted_at: workStatus === 'concreted' ? level.concreted_at || today() : null,
                  });
                }}
              >
                <option value="pending">Pendiente</option>
                <option value="in_progress">En ejecución</option>
                <option value="concreted">Hormigonado</option>
              </select>
              {level.work_status === 'concreted' ? (
                <Input
                  aria-label="Fecha de hormigonado"
                  className="h-9 w-[145px]"
                  type="date"
                  value={level.concreted_at ?? ''}
                  onChange={(event) => levelMutation.mutate({ concreted_at: event.target.value || null })}
                />
              ) : null}
            </>
          ) : (
            <LevelStatusBadge level={level} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {checklistQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando checklist del nivel…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3">
            <p className="text-sm text-muted-foreground">Este nivel aún no tiene controles propios.</p>
            {canEditChecklist ? (
              <Button size="sm" variant="outline" disabled={initializeMutation.isPending} onClick={() => initializeMutation.mutate()}>
                <RefreshCw className="h-4 w-4" /> Crear checklist estándar
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {items.map((item) => {
              const canUpdate = canEditChecklist || canChangeStatus(item.assigned_user_id);
              const completed = item.status === 'completed';
              return (
                <div key={item.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex min-w-0 items-center gap-3 text-sm">
                    <input
                      aria-label={`Completar ${item.title}`}
                      className="h-4 w-4 accent-primary"
                      type="checkbox"
                      checked={completed}
                      disabled={!canUpdate || itemMutation.isPending}
                      onChange={(event) => toggleItem(item, event.target.checked)}
                    />
                    <span className={completed ? 'line-through text-muted-foreground' : ''}>{item.title}</span>
                  </label>
                  <div className="flex items-center gap-2 pl-7 sm:pl-0">
                    <Label className="text-xs text-muted-foreground" htmlFor={`performed-${item.id}`}>Fecha</Label>
                    <Input
                      id={`performed-${item.id}`}
                      className="h-8 w-[142px]"
                      type="date"
                      value={item.performed_on ?? ''}
                      disabled={!canEditChecklist || itemMutation.isPending}
                      onChange={(event) => itemMutation.mutate({
                        itemId: item.id,
                        payload: { performed_on: event.target.value || null },
                      })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanCanvas({
  planUrl,
  version,
  levels,
  annotations,
  selectedLevelId,
  onSelectLevel,
  onCreateAnnotation,
  onMapLevel,
  canEdit,
  onDeleteAnnotation,
}: {
  planUrl: string;
  version: PlanVersion;
  levels: Level[];
  annotations: PlanAnnotation[];
  selectedLevelId: string | null;
  onSelectLevel: (levelId: string) => void;
  onCreateAnnotation: (input: {
    annotation_type: PlanAnnotation['annotation_type'];
    geometry_json: Record<string, unknown>;
    comment?: string | null;
    level_id?: string | null;
  }) => void;
  onMapLevel: (levelId: string, geometry: LevelPlanGeometry) => void;
  canEdit: boolean;
  onDeleteAnnotation: (annotationId: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<
    | { kind: 'pan'; clientX: number; clientY: number; offsetX: number; offsetY: number }
    | { kind: 'draw' }
    | { kind: 'map-level' }
    | null
  >(null);
  const drawingRef = useRef<Point[]>([]);
  const mappingRef = useRef<{ start: Point; end: Point } | null>(null);
  const [tool, setTool] = useState<Tool>('pan');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState<Point[]>([]);
  const [mapping, setMapping] = useState<{ start: Point; end: Point } | null>(null);
  const [note, setNote] = useState<{ point: Point; text: string } | null>(null);

  const mappedLevels = levels.filter(
    (level) => level.plan_version_id === version.id && level.plan_page_number === 1 && level.plan_geometry_json,
  );

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): Point | null => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'pan') {
      interaction.current = {
        kind: 'pan',
        clientX: event.clientX,
        clientY: event.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
      return;
    }
    if (!canEdit) return;
    if (tool === 'note') {
      setNote({ point, text: '' });
      return;
    }
    if (tool === 'draw') {
      interaction.current = { kind: 'draw' };
      drawingRef.current = [point];
      setDrawing([point]);
      return;
    }
    if (tool === 'map-level' && selectedLevelId) {
      interaction.current = { kind: 'map-level' };
      mappingRef.current = { start: point, end: point };
      setMapping(mappingRef.current);
    }
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interaction.current;
    if (!active) return;
    if (active.kind === 'pan') {
      setOffset({
        x: active.offsetX + event.clientX - active.clientX,
        y: active.offsetY + event.clientY - active.clientY,
      });
      return;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    if (active.kind === 'draw') {
      const last = drawingRef.current[drawingRef.current.length - 1];
      if (!last || Math.abs(last.x - point.x) + Math.abs(last.y - point.y) > 0.002) {
        drawingRef.current = [...drawingRef.current, point];
        setDrawing(drawingRef.current);
      }
    }
    if (active.kind === 'map-level' && mappingRef.current) {
      mappingRef.current = { ...mappingRef.current, end: point };
      setMapping(mappingRef.current);
    }
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interaction.current;
    interaction.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!active) return;
    if (active.kind === 'draw') {
      const points = drawingRef.current;
      drawingRef.current = [];
      setDrawing([]);
      if (points.length > 1) {
        onCreateAnnotation({
          annotation_type: 'line',
          geometry_json: { points },
          level_id: selectedLevelId,
        });
      }
    }
    if (active.kind === 'map-level' && selectedLevelId && mappingRef.current) {
      const geometry = geometryFromPoints(mappingRef.current.start, mappingRef.current.end);
      mappingRef.current = null;
      setMapping(null);
      if (geometry) onMapLevel(selectedLevelId, geometry);
    }
  };

  const saveNote = () => {
    if (!note?.text.trim()) return;
    onCreateAnnotation({
      annotation_type: 'note',
      geometry_json: note.point,
      comment: note.text.trim(),
      level_id: selectedLevelId,
    });
    setNote(null);
    setTool('pan');
  };

  const mappingGeometry = mapping ? geometryFromPoints(mapping.start, mapping.end) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={tool === 'pan' ? 'secondary' : 'outline'} onClick={() => setTool('pan')}>
            <Hand /> Mover
          </Button>
          {canEdit ? (
            <>
              <Button size="sm" variant={tool === 'note' ? 'secondary' : 'outline'} onClick={() => setTool('note')}>
                <MessageSquarePlus /> Texto
              </Button>
              <Button size="sm" variant={tool === 'draw' ? 'secondary' : 'outline'} onClick={() => setTool('draw')}>
                <PencilLine /> Dibujar
              </Button>
              <Button
                size="sm"
                variant={tool === 'map-level' ? 'secondary' : 'outline'}
                disabled={!selectedLevelId}
                onClick={() => setTool('map-level')}
              >
                Ubicar nivel
              </Button>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Alejar plano" onClick={() => setScale((value) => Math.max(0.65, value - 0.2))}>
            <ZoomOut />
          </Button>
          <span className="w-12 text-center text-xs text-muted-foreground">{Math.round(scale * 100)}%</span>
          <Button size="icon" variant="outline" aria-label="Acercar plano" onClick={() => setScale((value) => Math.min(3, value + 0.2))}>
            <ZoomIn />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>
            Restablecer
          </Button>
        </div>
      </div>
      {tool === 'map-level' ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Arrastra sobre el plano para marcar el área de <strong>{levels.find((level) => level.id === selectedLevelId)?.name}</strong>.
        </p>
      ) : null}
      <div className="relative h-[620px] overflow-hidden rounded-lg border bg-slate-100 shadow-inner">
        <div
          ref={contentRef}
          className="absolute left-0 top-0 w-full touch-none select-none"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: '0 0' }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        >
          <img className="block w-full" draggable={false} src={planUrl} alt={`Vista del plano ${version.original_filename}`} />
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
            {mappedLevels.map((level) => {
              const geometry = level.plan_geometry_json as LevelPlanGeometry;
              const status = LEVEL_STATUS[level.work_status];
              return (
                <g key={level.id}>
                  <rect
                    x={geometry.x * 1000}
                    y={geometry.y * 1000}
                    width={geometry.width * 1000}
                    height={geometry.height * 1000}
                    fill={status.color}
                    fillOpacity={level.id === selectedLevelId ? 0.36 : 0.19}
                    stroke={status.color}
                    strokeWidth={level.id === selectedLevelId ? 5 : 3}
                    className="cursor-pointer"
                    onClick={(event) => {
                      if (tool !== 'pan') return;
                      event.stopPropagation();
                      onSelectLevel(level.id);
                    }}
                  />
                  <text
                    x={(geometry.x + geometry.width / 2) * 1000}
                    y={(geometry.y + geometry.height / 2) * 1000}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#111827"
                    fontSize="20"
                    fontWeight="700"
                    pointerEvents="none"
                  >
                    {level.name}
                  </text>
                </g>
              );
            })}
            {annotations.map((annotation) => {
              if (annotation.page_number !== 1 || annotation.status === 'resolved') return null;
              const color = typeof annotation.style_json.stroke === 'string' ? annotation.style_json.stroke : '#f97316';
              if (annotation.annotation_type === 'line') {
                const points = annotationPoints(annotation);
                if (points.length < 2) return null;
                return (
                  <polyline
                    key={annotation.id}
                    fill="none"
                    stroke={color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')}
                  />
                );
              }
              if (annotation.annotation_type === 'note') {
                const point = annotationPoint(annotation);
                if (!point) return null;
                return (
                  <g key={annotation.id}>
                    <rect x={point.x * 1000} y={point.y * 1000} width="210" height="38" rx="5" fill="#ffedd5" stroke="#f97316" />
                    <text x={point.x * 1000 + 8} y={point.y * 1000 + 24} fill="#7c2d12" fontSize="18" pointerEvents="none">
                      {(annotation.comment || 'Nota').slice(0, 24)}
                    </text>
                  </g>
                );
              }
              return null;
            })}
            {drawing.length > 1 ? (
              <polyline
                fill="none"
                stroke="#2563eb"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={drawing.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')}
              />
            ) : null}
            {mappingGeometry ? (
              <rect
                x={mappingGeometry.x * 1000}
                y={mappingGeometry.y * 1000}
                width={mappingGeometry.width * 1000}
                height={mappingGeometry.height * 1000}
                fill="#2563eb"
                fillOpacity="0.16"
                stroke="#2563eb"
                strokeWidth="4"
                strokeDasharray="12 8"
              />
            ) : null}
          </svg>
          {note ? (
            <div
              className="absolute z-10 w-56 rounded-md border bg-background p-2 shadow-lg"
              style={{ left: `${note.point.x * 100}%`, top: `${note.point.y * 100}%` }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Input
                autoFocus
                placeholder="Escribe una nota"
                value={note.text}
                onChange={(event) => setNote({ ...note, text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveNote();
                  if (event.key === 'Escape') setNote(null);
                }}
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setNote(null)}>Cancelar</Button>
                <Button size="sm" onClick={saveNote}>Guardar</Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Plano protegido · los cambios se sincronizan con los usuarios con acceso.</span>
        <span>{annotations.length} anotación(es)</span>
      </div>
      {annotations.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {annotations.slice(-6).map((annotation) => (
            <div key={annotation.id} className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
              <span>{annotation.annotation_type === 'line' ? 'Dibujo' : annotation.comment || 'Nota'}</span>
              {canEdit ? (
                <button className="rounded p-0.5 text-muted-foreground hover:text-destructive" aria-label="Eliminar anotación" onClick={() => onDeleteAnnotation(annotation.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
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
  const plans = plansQuery.data ?? [];
  const levels = [...asItems(levelsQuery.data)].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
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
    void queryClient.invalidateQueries({ queryKey: ['project', companyId, project.id] });
  };
  const annotationMutation = useMutation({
    mutationFn: ({
      versionId,
      input,
    }: {
      versionId: string;
      input: Parameters<typeof plansApi.createAnnotation>[3];
    }) => plansApi.createAnnotation(companyId, project.id, versionId, input),
    onSuccess: invalidateBoard,
    onError: (error: Error) => toast.error(error.message),
  });
  const mapMutation = useMutation({
    mutationFn: ({ levelId, versionId, geometry }: { levelId: string; versionId: string; geometry: LevelPlanGeometry }) =>
      projectsApi.updateLevel(companyId, project.id, levelId, {
        plan_version_id: versionId,
        plan_page_number: 1,
        plan_geometry_json: geometry,
      }),
    onSuccess: () => {
      toast.success('Nivel ubicado en el plano');
      invalidateBoard();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteAnnotationMutation = useMutation({
    mutationFn: (annotationId: string) => plansApi.deleteAnnotation(companyId, project.id, annotationId),
    onSuccess: invalidateBoard,
    onError: (error: Error) => toast.error(error.message),
  });

  const selectedLevel = levels.find((level) => level.id === selectedLevelId) ?? null;

  if (plansQuery.isLoading || levelsQuery.isLoading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Preparando tablero de obra…</CardContent></Card>;
  }
  if (!version) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Tablero de obra</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Para usar el resumen visual, carga un PDF o una imagen desde la pestaña <strong>Planos</strong>.</p>
          <p>Luego pulsa <strong>Mostrar en resumen</strong> en la versión que quieres compartir con el equipo.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Plano operativo</h2>
          <p className="text-sm text-muted-foreground">{version.original_filename} · vista principal de la obra</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {levels.map((level) => (
            <Button
              key={level.id}
              size="sm"
              variant={selectedLevelId === level.id ? 'default' : 'outline'}
              onClick={() => setSelectedLevelId(level.id)}
            >
              {level.name}
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: LEVEL_STATUS[level.work_status].color }} />
            </Button>
          ))}
        </div>
      </div>
      <BuildingSummary levels={levels} />
      {previewQuery.isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Preparando la vista privada del plano…</CardContent></Card>
      ) : previewQuery.isError || !planUrl ? (
        <Card><CardContent className="p-6 text-sm text-destructive">No se pudo mostrar este plano. Verifica su archivo desde Planos.</CardContent></Card>
      ) : (
        <PlanCanvas
          planUrl={planUrl}
          version={version}
          levels={levels}
          annotations={annotationsQuery.data ?? []}
          selectedLevelId={selectedLevelId}
          onSelectLevel={setSelectedLevelId}
          canEdit={canEditPlan}
          onCreateAnnotation={(input) => annotationMutation.mutate({ versionId: version.id, input: { page_number: 1, ...input } })}
          onMapLevel={(levelId, geometry) => mapMutation.mutate({ levelId, versionId: version.id, geometry })}
          onDeleteAnnotation={(annotationId) => deleteAnnotationMutation.mutate(annotationId)}
        />
      )}
      {selectedLevel ? <LevelChecklistCard companyId={companyId} projectId={project.id} level={selectedLevel} /> : (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">Crea niveles para tener un checklist individual y ubicarlos en el plano.</CardContent></Card>
      )}
    </div>
  );
}
