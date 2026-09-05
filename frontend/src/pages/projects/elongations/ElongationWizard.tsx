import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Download,
  FileImage,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { membersApi, plansApi, saveBlob } from '@/lib/api/modules';
import { projectsApi } from '@/lib/api/projects';
import {
  elongationLabels,
  elongationsApi,
  reviewLabels,
  type ElongationItemPatch,
  type ElongationJobInput,
  type ElongationMeasurementPatch,
} from '@/lib/api/elongations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  ElongationClassification,
  ElongationClassificationZone,
  ElongationItemV2,
  ElongationJobFile,
  ElongationJobV2,
  ElongationMeasurement,
  Level,
  Paginated,
} from '@/types/api';

type WizardStep =
  | 'sources'
  | 'theory'
  | 'review'
  | 'theoretical'
  | 'measurements'
  | 'reconcile'
  | 'approval'
  | 'result';

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'sources', label: '1. Fuentes' },
  { id: 'theory', label: '2. Lectura' },
  { id: 'review', label: '3. Plano' },
  { id: 'theoretical', label: '4. Excel teórico' },
  { id: 'measurements', label: '5. Mediciones' },
  { id: 'reconcile', label: '6. Conciliación' },
  { id: 'approval', label: '7. Aprobación' },
  { id: 'result', label: '8. Resultado' },
];

const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function queryLevels(value: Paginated<Level> | Level[] | undefined): Level[] {
  return Array.isArray(value) ? value : value?.items ?? [];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function download(blob: Blob, filename: string): void {
  saveBlob(blob, filename);
}

function openFile(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function JobBadge({ job }: { job: ElongationJobV2 }) {
  const status = job.workflow_status;
  const variant = status.startsWith('failed') ? 'destructive' : status.includes('review') ? 'warning' : status === 'approved' ? 'success' : 'muted';
  return <Badge variant={variant}>{status.replace(/_/g, ' ')}</Badge>;
}

function ProgressLine({ job }: { job: ElongationJobV2 }) {
  const progress = job.progress;
  return (
    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
      <span>Teoría pendiente: {progress.groups_pending}/{progress.groups_total}</span>
      <span>Mediciones: {progress.measurements_detected}/{progress.measurements_expected}</span>
      <span>Conflictos: {progress.unresolved_conflicts}</span>
    </div>
  );
}

function SourceForm({
  companyId,
  projectId,
  onCreated,
}: {
  companyId: string;
  projectId: string;
  onCreated: (job: ElongationJobV2) => void;
}) {
  const canEdit = useCan('documents.edit');
  const planInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [planVersionId, setPlanVersionId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const plansQuery = useQuery({
    queryKey: ['plans', companyId, projectId],
    queryFn: ({ signal }) => plansApi.list(companyId, projectId, signal),
  });
  const levelsQuery = useQuery({
    queryKey: ['levels', companyId, projectId],
    queryFn: ({ signal }) => projectsApi.listLevels(companyId, projectId, signal),
  });
  const membersQuery = useQuery({
    queryKey: ['members', companyId],
    queryFn: ({ signal }) => membersApi.list(companyId, signal),
  });
  const createMutation = useMutation({
    mutationFn: () => {
      const input: ElongationJobInput = {
        title: title.trim(),
        templateFile: templateFile as File,
        planFile,
        planVersionId: planFile ? null : planVersionId || null,
        levelId: levelId || null,
        responsibleUserId: responsibleUserId || null,
      };
      return elongationsApi.create(companyId, projectId, input);
    },
    onSuccess: (job) => {
      toast.success('Trabajo creado; la lectura teórica se ejecuta en segundo plano.');
      onCreated(job);
    },
    onError: (error) => toast.error(errorMessage(error, 'No se pudo crear el trabajo.')),
  });
  const levels = queryLevels(levelsQuery.data);
  const existingVersions = plansQuery.data?.flatMap((plan) =>
    plan.versions.map((version) => ({ id: version.id, label: `${plan.title} · v${version.version_number}` })),
  ) ?? [];
  const invalidSource = !planFile && !planVersionId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. Datos y fuentes</CardTitle>
        <CardDescription>
          Cargue el plano y la plantilla XLSX. La plantilla se valida antes de iniciar OCR y queda guardada como fuente privada e inmutable.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="elongation-title">Nombre del trabajo</Label>
          <Input id="elongation-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Lista de elongaciones - nivel 1" disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="elongation-level">Nivel (opcional)</Label>
          <select id="elongation-level" className={selectClass} value={levelId} onChange={(event) => setLevelId(event.target.value)} disabled={!canEdit}>
            <option value="">Sin nivel</option>
            {levels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="elongation-owner">Responsable (opcional)</Label>
          <select id="elongation-owner" className={selectClass} value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)} disabled={!canEdit}>
            <option value="">Sin responsable</option>
            {membersQuery.data?.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="elongation-plan-file">Plano PDF o imagen</Label>
          <Input
            ref={planInputRef}
            id="elongation-plan-file"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={!canEdit}
            onChange={(event) => {
              setPlanFile(event.target.files?.[0] ?? null);
              if (event.target.files?.[0]) setPlanVersionId('');
            }}
          />
          <p className="text-xs text-muted-foreground">{planFile?.name ?? 'O seleccione una versión existente.'}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="elongation-plan-version">Versión de plano existente</Label>
          <select id="elongation-plan-version" className={selectClass} value={planVersionId} onChange={(event) => { setPlanVersionId(event.target.value); if (event.target.value) { setPlanFile(null); if (planInputRef.current) planInputRef.current.value = ''; } }} disabled={!canEdit || Boolean(planFile)}>
            <option value="">Seleccione una versión</option>
            {existingVersions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="elongation-template">Plantilla XLSX obligatoria</Label>
          <Input ref={templateInputRef} id="elongation-template" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!canEdit} onChange={(event) => setTemplateFile(event.target.files?.[0] ?? null)} />
          <p className="text-xs text-muted-foreground">Se rechazan macros, enlaces externos y archivos que no sean XLSX seguros.</p>
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button disabled={!canEdit || !title.trim() || !templateFile || invalidSource || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? <Loader2 className="animate-spin" /> : <ScanLine />}
            {createMutation.isPending ? 'Validando y creando...' : 'Crear y leer teoría'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SourceFiles({ companyId, projectId, job }: { companyId: string; projectId: string; job: ElongationJobV2 }) {
  const open = async (file: ElongationJobFile) => {
    try {
      openFile(await elongationsApi.file(companyId, projectId, job.id, file.id));
    } catch (error) {
      toast.error(errorMessage(error, 'No se pudo abrir el archivo.'));
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>Fuentes del trabajo</CardTitle><CardDescription>Las originales se mantienen protegidas y cada versión conserva su SHA-256.</CardDescription></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {job.files.filter((file) => ['plan', 'template', 'measurement_scan'].includes(file.kind)).map((file) => (
          <div key={file.id} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <div className="min-w-0"><p className="truncate font-medium">{file.original_filename}</p><p className="text-xs text-muted-foreground">{file.kind} · v{file.version_number} · {file.processing_status}</p></div>
            <Button size="sm" variant="outline" onClick={() => void open(file)}><FileImage /> Ver</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function normalisedBox(item: ElongationItemV2): { x: number; y: number; width: number; height: number } | null {
  const location = item.source_location_json;
  const box = location?.bbox;
  if (!box || typeof box !== 'object') return null;
  const values = box as Record<string, unknown>;
  const x = Number(values.x);
  const y = Number(values.y);
  const width = Number(values.width);
  const height = Number(values.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

type NormalisedBox = { x: number; y: number; width: number; height: number };
type ZoneInput = {
  classification: Exclude<ElongationClassification, 'unknown'>;
  geometry: { page: number; x: number; y: number; width: number; height: number };
  name?: string;
};

function asNormalisedBox(value: Record<string, unknown> | null | undefined): NormalisedBox | null {
  if (!value) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function PlanReviewPreview({
  companyId,
  projectId,
  job,
  canEdit,
  onCreateZone,
  onDeleteZone,
}: {
  companyId: string;
  projectId: string;
  job: ElongationJobV2;
  canEdit: boolean;
  onCreateZone: (input: ZoneInput) => void;
  onDeleteZone: (zone: ElongationClassificationZone) => void;
}) {
  const source = job.files.find((file) => file.kind === 'plan');
  const sourceId = source?.id;
  const pageCount = Math.max(1, source?.page_count ?? 1);
  const [page, setPage] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState<{ x: number; y: number } | null>(null);
  const [draftEnd, setDraftEnd] = useState<{ x: number; y: number } | null>(null);
  const [zoneClass, setZoneClass] = useState<Exclude<ElongationClassification, 'unknown'>>('band');
  const [zoneName, setZoneName] = useState('');
  useEffect(() => {
    if (!sourceId) return undefined;
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    void elongationsApi.preview(companyId, projectId, job.id, sourceId, page).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(null));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [companyId, job.id, page, projectId, sourceId]);
  if (!source) return null;
  const boxes = job.items
    .filter((item) => (item.source_page ?? 1) === page)
    .map((item) => ({ item, box: normalisedBox(item) }))
    .filter((entry): entry is { item: ElongationItemV2; box: NormalisedBox } => entry.box !== null);
  const zones = job.zones.filter((zone) => Number(zone.geometry_json.page ?? 1) === page);
  const draft = draftStart && draftEnd ? {
    x: Math.min(draftStart.x, draftEnd.x),
    y: Math.min(draftStart.y, draftEnd.y),
    width: Math.abs(draftEnd.x - draftStart.x),
    height: Math.abs(draftEnd.y - draftStart.y),
  } : null;
  const pointFor = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  };
  const beginDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canEdit || !url) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFor(event);
    setDraftStart(point);
    setDraftEnd(point);
  };
  const continueDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draftStart) return;
    setDraftEnd(pointFor(event));
  };
  const finishDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draftStart) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraftEnd(pointFor(event));
  };
  const saveZone = () => {
    if (!draft || draft.width < 0.01 || draft.height < 0.01) {
      toast.error('Dibuje una zona visible sobre el plano antes de guardarla.');
      return;
    }
    onCreateZone({ classification: zoneClass, geometry: { page, ...draft }, name: zoneName.trim() || undefined });
    setDraftStart(null);
    setDraftEnd(null);
    setZoneName('');
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Visor del plano</CardTitle>
        <CardDescription>La vista previa autenticada permite revisar las cajas OCR y dibujar zonas de Banda o Distribuido sin exponer el original.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {pageCount > 1 ? <select className={`${selectClass} w-auto`} value={page} onChange={(event) => setPage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>Página {index + 1}</option>)}</select> : <Badge variant="muted">Página {page}</Badge>}
          <Badge variant="muted">{boxes.length} candidato(s) con ubicación</Badge>
          {canEdit ? <span className="text-xs text-muted-foreground">Arrastre sobre el plano para definir una zona.</span> : null}
        </div>
        {!url ? <p className="text-sm text-muted-foreground">Cargando vista previa protegida…</p> : <div className="overflow-auto rounded-md border bg-muted p-2"><div className={`relative mx-auto inline-block max-w-full ${canEdit ? 'touch-none cursor-crosshair' : ''}`} onPointerDown={beginDraw} onPointerMove={continueDraw} onPointerUp={finishDraw}><img className="block max-h-[34rem] max-w-full select-none" src={url} alt={`Plano fuente, página ${page}`} draggable={false} />{boxes.map(({ item, box }) => <span key={item.id} title={`${item.label}: ${item.raw_text || ''}`} className={`absolute border-2 text-[10px] font-semibold ${item.classification === 'unknown' ? 'border-amber-500 bg-amber-100/70 text-amber-950' : item.classification === 'band' ? 'border-sky-600 bg-sky-100/70 text-sky-950' : 'border-violet-600 bg-violet-100/70 text-violet-950'}`} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}>{item.label}</span>)}{zones.map((zone) => { const geometry = asNormalisedBox(zone.geometry_json); return geometry ? <span key={zone.id} title={zone.name || elongationLabels[zone.classification]} className={`pointer-events-none absolute border-2 border-dashed ${zone.classification === 'band' ? 'border-sky-600 bg-sky-100/15' : 'border-violet-600 bg-violet-100/15'}`} style={{ left: `${geometry.x * 100}%`, top: `${geometry.y * 100}%`, width: `${geometry.width * 100}%`, height: `${geometry.height * 100}%` }} /> : null; })}{draft ? <span className={`pointer-events-none absolute border-2 border-dashed ${zoneClass === 'band' ? 'border-sky-700 bg-sky-100/30' : 'border-violet-700 bg-violet-100/30'}`} style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} /> : null}</div></div>}
        {draft && canEdit ? <div className="flex flex-wrap items-end gap-2 rounded-md border p-3"><div className="space-y-1"><Label>Clase de zona</Label><select className={selectClass} value={zoneClass} onChange={(event) => setZoneClass(event.target.value as Exclude<ElongationClassification, 'unknown'>)}><option value="band">Banda</option><option value="distributed">Distribuido</option></select></div><div className="min-w-48 flex-1 space-y-1"><Label>Nombre (opcional)</Label><Input value={zoneName} onChange={(event) => setZoneName(event.target.value)} placeholder="Ej. banda borde norte" /></div><Button size="sm" onClick={saveZone}>Aplicar zona</Button><Button size="sm" variant="outline" onClick={() => { setDraftStart(null); setDraftEnd(null); }}>Cancelar</Button></div> : null}
        {zones.length ? <div className="flex flex-wrap gap-2 text-xs">{zones.map((zone) => <span key={zone.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-1">{elongationLabels[zone.classification]}{zone.name ? ` · ${zone.name}` : ''}{canEdit ? <button type="button" className="ml-1 text-destructive underline" onClick={() => onDeleteZone(zone)}>quitar</button> : null}</span>)}</div> : null}
        <p className="text-xs text-muted-foreground">Los rectángulos son sugerencias trazables: una zona reclasifica solo los centros de candidatos de esta página y reinicia la revisión cuando cambia un dato aprobado.</p>
      </CardContent>
    </Card>
  );
}

function TheoryStep({ companyId, projectId, job, refresh }: { companyId: string; projectId: string; job: ElongationJobV2; refresh: () => void }) {
  const canEdit = useCan('documents.edit');
  const retry = useMutation({
    mutationFn: () => elongationsApi.retry(companyId, projectId, job.id),
    onSuccess: () => { toast.success('Reintento iniciado.'); refresh(); },
    onError: (error) => toast.error(errorMessage(error, 'No se pudo reintentar.')),
  });
  const processing = ['queued_theory', 'processing_theory'].includes(job.workflow_status);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card><CardHeader><CardTitle>2. Lectura teórica</CardTitle><CardDescription>Solo se crean candidatos que contienen Tendon, S, L y Elong; fechas y leyendas no se convierten en filas.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex items-center gap-2"><JobBadge job={job} /> {processing ? <span className="flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Procesando en segundo plano…</span> : null}</div><ProgressLine job={job} />{job.error_message ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{job.error_message}</p> : null}{canEdit && job.workflow_status === 'failed_theory' ? <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}><RefreshCw /> Reintentar lectura</Button> : null}</CardContent></Card>
      <SourceFiles companyId={companyId} projectId={projectId} job={job} />
    </div>
  );
}

function TheoryReview({ companyId, projectId, job, refresh }: { companyId: string; projectId: string; job: ElongationJobV2; refresh: () => void }) {
  const canEdit = useCan('documents.edit');
  const canApprove = useCan('documents.approve');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'unknown' | 'doubtful'>('all');
  const requiresInvalidation = Boolean(job.theory_approved_at || job.approved_at);
  const confirmInvalidation = () => !requiresInvalidation || window.confirm('Este cambio invalida la aprobación vigente y exige una nueva revisión técnica. ¿Continuar?');
  const update = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ElongationItemPatch }) => elongationsApi.updateItem(companyId, projectId, job.id, itemId, patch),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, 'No se pudo guardar la corrección.')),
  });
  const classify = useMutation({
    mutationFn: (classification: Exclude<ElongationClassification, 'unknown'>) => elongationsApi.classify(companyId, projectId, job.id, selected, classification),
    onSuccess: () => { setSelected([]); refresh(); },
    onError: (error) => toast.error(errorMessage(error, 'No se pudo clasificar.')),
  });
  const createZone = useMutation({
    mutationFn: (input: ZoneInput) => elongationsApi.createZone(companyId, projectId, job.id, input),
    onSuccess: () => { toast.success('Zona aplicada a los candidatos incluidos.'); refresh(); },
    onError: (error) => toast.error(errorMessage(error, 'No se pudo aplicar la zona.')),
  });
  const deleteZone = useMutation({
    mutationFn: (zoneId: string) => elongationsApi.deleteZone(companyId, projectId, job.id, zoneId),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, 'No se pudo quitar la zona.')),
  });
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const visibleItems = job.items.filter((item) => {
    if (filter === 'unknown') return item.classification === 'unknown';
    if (filter === 'doubtful') return item.theory_review_status === 'conflict' || Number(item.confidence ?? 0) < 0.7;
    return true;
  });
  const applyPatch = (itemId: string, patch: ElongationItemPatch) => {
    if (requiresInvalidation && !confirmInvalidation()) return;
    update.mutate({ itemId, patch });
  };
  const applyClassification = (classification: Exclude<ElongationClassification, 'unknown'>) => {
    if (!selected.length || (requiresInvalidation && !confirmInvalidation())) return;
    classify.mutate(classification);
  };
  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle>3. Revisión sobre el plano</CardTitle><CardDescription>Corrija los cuatro campos y la clase. Las coordenadas y el texto fuente se conservan por registro; seleccione varios o dibuje una zona para reclasificar.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={!canEdit || selected.length === 0 || classify.isPending} onClick={() => applyClassification('band')}>Marcar {selected.length || ''} como Bandas</Button><Button size="sm" variant="outline" disabled={!canEdit || selected.length === 0 || classify.isPending} onClick={() => applyClassification('distributed')}>Marcar {selected.length || ''} como Distribuidos</Button><select aria-label="Filtrar candidatos" className={`${selectClass} w-auto`} value={filter} onChange={(event) => setFilter(event.target.value as 'all' | 'unknown' | 'doubtful')}><option value="all">Todos</option><option value="unknown">Sin clasificar</option><option value="doubtful">Dudosos / conflicto</option></select><Badge variant="muted">{selected.length} seleccionados</Badge></CardContent></Card>
      {job.items.length === 0 ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Aún no hay bloques teóricos completos para revisar.</CardContent></Card> : null}
      <PlanReviewPreview companyId={companyId} projectId={projectId} job={job} canEdit={canEdit} onCreateZone={(input) => { if (!requiresInvalidation || confirmInvalidation()) createZone.mutate(input); }} onDeleteZone={(zone) => { if (window.confirm(`¿Quitar la zona ${zone.name || elongationLabels[zone.classification]}? La clasificación ya aplicada se conserva para auditoría.`)) deleteZone.mutate(zone.id); }} />
      <div className="grid gap-3 xl:grid-cols-2">
        {visibleItems.map((item) => <TheoryCard key={item.id} item={item} selected={selected.includes(item.id)} canEdit={canEdit} canApprove={canApprove} onToggle={() => toggle(item.id)} onPatch={(patch) => applyPatch(item.id, patch)} />)}
      </div>
      {job.items.length > 0 && visibleItems.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">No hay candidatos para este filtro.</CardContent></Card> : null}
    </div>
  );
}

function TheoryCard({ item, selected, canEdit, canApprove, onToggle, onPatch }: { item: ElongationItemV2; selected: boolean; canEdit: boolean; canApprove: boolean; onToggle: () => void; onPatch: (patch: ElongationItemPatch) => void }) {
  const location = item.source_location_json ?? {};
  const confidence = item.confidence === null ? 'sin confianza' : `${Math.round(Number(item.confidence) * 100)}%`;
  return <Card><CardContent className="space-y-3 p-4"><div className="flex items-start justify-between gap-2"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={selected} onChange={onToggle} disabled={!canEdit} /> {item.label}</label><Badge variant={item.theory_review_status === 'conflict' ? 'destructive' : item.theory_review_status === 'approved' ? 'success' : 'warning'}>{reviewLabels[item.theory_review_status]}</Badge></div><div className="grid gap-2 sm:grid-cols-2"><div><Label>Label</Label><Input defaultValue={item.label} disabled={!canEdit} onBlur={(event) => event.target.value !== item.label && onPatch({ label: event.target.value })} /></div><div><Label>Clase</Label><select className={selectClass} value={item.classification} disabled={!canEdit} onChange={(event) => onPatch({ classification: event.target.value as ElongationClassification })}>{(['unknown', 'band', 'distributed'] as ElongationClassification[]).map((value) => <option key={value} value={value}>{elongationLabels[value]}</option>)}</select></div><div><Label>Longitud (m)</Label><Input defaultValue={item.length_m} inputMode="decimal" disabled={!canEdit} onBlur={(event) => event.target.value !== item.length_m && onPatch({ length_m: event.target.value })} /></div><div><Label>S / tendones físicos</Label><Input defaultValue={item.strand_count} type="number" min="1" disabled={!canEdit} onBlur={(event) => Number(event.target.value) !== item.strand_count && onPatch({ strand_count: Number(event.target.value) })} /></div><div><Label>Elong. calculada (cm)</Label><Input defaultValue={item.calculated_elongation} inputMode="decimal" disabled={!canEdit} onBlur={(event) => event.target.value !== item.calculated_elongation && onPatch({ calculated_elongation: event.target.value })} /></div><div><Label>Confianza real</Label><p className="mt-2 text-sm">{confidence}</p></div></div><div className="rounded bg-muted/60 p-2 text-xs text-muted-foreground"><p className="font-medium text-foreground">Fuente: {item.raw_label || item.label}</p><p className="line-clamp-2">{item.raw_text || 'Sin texto OCR.'}</p><p>Página {item.source_page ?? '—'} · {Object.keys(location).length ? 'ubicación disponible' : 'sin ubicación'}</p></div><div className="flex flex-wrap gap-2">{canApprove && item.theory_review_status !== 'approved' ? <Button size="sm" onClick={() => onPatch({ theory_review_status: 'approved' })}><CheckCircle2 /> Revisar teoría</Button> : null}{canApprove && item.theory_review_status === 'approved' ? <Button size="sm" variant="outline" onClick={() => onPatch({ theory_review_status: 'pending' })}>Reabrir revisión</Button> : null}</div></CardContent></Card>;
}

function TheoryExport({ companyId, projectId, job, refresh }: { companyId: string; projectId: string; job: ElongationJobV2; refresh: () => void }) {
  const canApprove = useCan('documents.approve');
  const canExport = useCan('documents.export');
  const approve = useMutation({ mutationFn: () => elongationsApi.approveTheory(companyId, projectId, job.id), onSuccess: () => { toast.success('Teoría aprobada.'); refresh(); }, onError: (error) => toast.error(errorMessage(error, 'No se pudo aprobar la teoría.')) });
  const exportFile = async () => { try { download(await elongationsApi.theoreticalExport(companyId, projectId, job.id), `${job.title}-teorico-v${job.version_number}.xlsx`); refresh(); } catch (error) { toast.error(errorMessage(error, 'No se pudo generar el Excel teórico.')); } };
  const mapping = job.template_mapping_json;
  return <Card><CardHeader><CardTitle>4. Excel teórico</CardTitle><CardDescription>Max. y Min. se generan como fórmulas por cada fila física, utilizando la regla validada de la plantilla.</CardDescription></CardHeader><CardContent className="space-y-4"><ProgressLine job={job} />{mapping ? <div className="rounded-md border p-3 text-sm"><p>Hoja: <strong>{String(mapping.sheet_name ?? '—')}</strong> · tolerancia: <strong>{job.tolerance_percent}%</strong></p><p className="mt-1 text-muted-foreground">{Array.isArray(mapping.warnings) && mapping.warnings.length ? String(mapping.warnings.join(' · ')) : 'Fórmula dominante validada; las fórmulas heredadas rotas no se copian.'}</p></div> : null}<Blockers blockers={job.progress.approval_blockers} /><div className="flex flex-wrap gap-2">{canApprove ? <Button disabled={!job.progress.can_approve_theory || approve.isPending || Boolean(job.theory_approved_at)} onClick={() => approve.mutate()}><ShieldCheck /> {job.theory_approved_at ? 'Teoría aprobada' : 'Aprobar teoría'}</Button> : null}{canExport ? <Button variant="outline" disabled={!job.theory_approved_at} onClick={() => void exportFile()}><FileSpreadsheet /> Descargar Excel teórico</Button> : null}</div></CardContent></Card>;
}

function MeasurementsStep({ companyId, projectId, job, refresh }: { companyId: string; projectId: string; job: ElongationJobV2; refresh: () => void }) {
  const canEdit = useCan('documents.edit');
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const upload = useMutation({ mutationFn: () => elongationsApi.uploadMeasurements(companyId, projectId, job.id, files), onSuccess: () => { toast.success('Archivos recibidos para lectura y revisión.'); setFiles([]); if (fileRef.current) fileRef.current.value = ''; refresh(); }, onError: (error) => toast.error(errorMessage(error, 'No se pudieron cargar las mediciones.')) });
  const startUpload = () => {
    if (job.approved_at && !window.confirm('Cargar nuevas lecturas invalida el resultado final aprobado. ¿Continuar?')) return;
    upload.mutate();
  };
  return <Card><CardHeader><CardTitle>5. Mediciones reales</CardTitle><CardDescription>Cargue varias fotos, PDF o escaneos. El original queda intacto y Tesseract solo propone valores; nunca los aprueba automáticamente.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="rounded-md bg-muted/60 p-3 text-sm">Primero se aplica orientación EXIF y contraste a una copia temporal. La asociación automática solo se acepta como propuesta con un Label impreso cercano.</div><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="flex-1 space-y-1"><Label htmlFor="measurement-files">Fotos o PDF</Label><Input ref={fileRef} id="measurement-files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={!canEdit || !job.theory_approved_at} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><p className="text-xs text-muted-foreground">{files.length ? `${files.length} archivo(s) listo(s)` : 'Puede seleccionar varios archivos.'}</p></div><Button disabled={!canEdit || !job.theory_approved_at || files.length === 0 || upload.isPending} onClick={startUpload}>{upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Analizar mediciones</Button></div>{!job.theory_approved_at ? <p className="text-sm text-amber-700">La carga se habilita cuando la teoría haya sido aprobada técnicamente.</p> : null}</CardContent></Card>;
}

function toleranceHint(measurement: ElongationMeasurement): string {
  switch (measurement.tolerance_status) {
    case 'within': return 'Dentro de tolerancia';
    case 'outside': return 'Fuera de tolerancia';
    case 'unresolved': return 'Conflicto sin resolver';
    default: return 'Falta valor';
  }
}

function Reconciliation({ companyId, projectId, job, refresh }: { companyId: string; projectId: string; job: ElongationJobV2; refresh: () => void }) {
  const canEdit = useCan('documents.edit');
  const canApprove = useCan('documents.approve');
  const update = useMutation({ mutationFn: ({ measurement, patch }: { measurement: ElongationMeasurement; patch: ElongationMeasurementPatch }) => elongationsApi.updateMeasurement(companyId, projectId, job.id, measurement.id, patch), onSuccess: refresh, onError: (error) => toast.error(errorMessage(error, 'No se pudo guardar la medición.')) });
  const applyPatch = (measurement: ElongationMeasurement, patch: ElongationMeasurementPatch) => {
    if (job.approved_at && !window.confirm('Esta corrección invalida el resultado final aprobado. ¿Continuar?')) return;
    update.mutate({ measurement, patch });
  };
  return <div className="space-y-3"><Card><CardHeader><CardTitle>6. Conciliación por Label</CardTitle><CardDescription>Cada grupo tiene exactamente S ordinales. Faltantes, sobrantes y conflictos permanecen visibles hasta la corrección humana.</CardDescription></CardHeader><CardContent><ProgressLine job={job} /></CardContent></Card>{job.items.map((item) => <Card key={item.id}><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{item.label} · {item.measurements.filter((measurement) => measurement.measured_elongation !== null).length}/{item.strand_count} detectadas</p><p className="text-xs text-muted-foreground">Calculada {item.calculated_elongation} cm · {elongationLabels[item.classification]}</p></div><Badge variant="muted">S={item.strand_count}</Badge></div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{item.measurements.map((measurement) => <MeasurementCard key={measurement.id} item={item} measurement={measurement} canEdit={canEdit} canApprove={canApprove} onPatch={(patch) => applyPatch(measurement, patch)} />)}</div></CardContent></Card>)}</div>;
}

function MeasurementCard({ item, measurement, canEdit, canApprove, onPatch }: { item: ElongationItemV2; measurement: ElongationMeasurement; canEdit: boolean; canApprove: boolean; onPatch: (patch: ElongationMeasurementPatch) => void }) {
  const hint = toleranceHint(measurement);
  const outside = hint === 'Fuera de tolerancia';
  return <div className="rounded-md border p-3"><div className="mb-2 flex items-center justify-between"><span className="font-medium">{item.label} · #{measurement.ordinal}</span><Badge variant={measurement.review_status === 'approved' ? 'success' : measurement.review_status === 'conflict' ? 'destructive' : 'warning'}>{reviewLabels[measurement.review_status]}</Badge></div><Label>Medida (cm)</Label><Input defaultValue={measurement.measured_elongation ?? ''} inputMode="decimal" placeholder="Ej. 4,8" disabled={!canEdit} onBlur={(event) => { const value = event.target.value.trim(); if (value !== (measurement.measured_elongation ?? '')) onPatch({ measured_elongation: value || null, match_method: 'manual' }); }} /><p className={outside ? 'mt-1 text-xs text-red-700' : 'mt-1 text-xs text-muted-foreground'}>{hint}</p><p className="mt-1 text-xs text-muted-foreground">Rango API: {measurement.minimum_elongation ?? '—'} a {measurement.maximum_elongation ?? '—'} cm</p><Label className="mt-2 block">Observación{outside ? ' obligatoria para aprobar' : ' (si aplica)'}</Label><Textarea className="min-h-14" defaultValue={measurement.override_reason ?? ''} disabled={!canEdit} onBlur={(event) => event.target.value !== (measurement.override_reason ?? '') && onPatch({ override_reason: event.target.value || null })} />{canApprove ? <div className="mt-2 flex gap-2"><Button size="sm" disabled={!measurement.measured_elongation} onClick={() => onPatch({ review_status: 'approved' })}><CheckCircle2 /> Aprobar</Button><Button size="sm" variant="outline" onClick={() => onPatch({ review_status: 'pending' })}>Pendiente</Button></div> : null}</div>;
}

function Blockers({ blockers }: { blockers: string[] }) {
  if (!blockers.length) return <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">No hay bloqueos para este paso.</p>;
  return <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800"><p className="font-medium">Bloqueos pendientes</p><ul className="mt-1 list-disc pl-5">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>;
}

function FinalApproval({ companyId, projectId, job, refresh }: { companyId: string; projectId: string; job: ElongationJobV2; refresh: () => void }) {
  const canApprove = useCan('documents.approve');
  const approve = useMutation({ mutationFn: () => elongationsApi.approveFinal(companyId, projectId, job.id), onSuccess: () => { toast.success('Resultado final aprobado.'); refresh(); }, onError: (error) => toast.error(errorMessage(error, 'No se pudo aprobar el resultado final.')) });
  return <Card><CardHeader><CardTitle>7. Aprobación técnica final</CardTitle><CardDescription>La API vuelve a validar clase, S, conflictos, medidas y observaciones. El supervisor puede corregir, pero no aprobar.</CardDescription></CardHeader><CardContent className="space-y-4"><ProgressLine job={job} /><Blockers blockers={job.progress.approval_blockers} />{canApprove ? <Button disabled={!job.progress.can_approve_final || approve.isPending || Boolean(job.approved_at)} onClick={() => approve.mutate()}><ShieldCheck /> {job.approved_at ? 'Resultado aprobado' : 'Aprobar resultado final'}</Button> : <p className="text-sm text-muted-foreground">Su rol puede corregir información, pero la aprobación requiere owner, admin o engineer.</p>}</CardContent></Card>;
}

function ResultStep({ companyId, projectId, job, refresh }: { companyId: string; projectId: string; job: ElongationJobV2; refresh: () => void }) {
  const canExport = useCan('documents.export');
  const finalExport = async () => { try { download(await elongationsApi.finalExport(companyId, projectId, job.id), `${job.title}-final-v${job.version_number}.xlsx`); refresh(); } catch (error) { toast.error(errorMessage(error, 'No se pudo generar el Excel final.')); } };
  const existing = job.files.filter((file) => ['theoretical_export', 'final_export'].includes(file.kind));
  return <div className="space-y-4"><Card><CardHeader><CardTitle>8. Resultado y versiones</CardTitle><CardDescription>El Excel final queda versionado e inmutable. Las exportaciones anteriores no se regeneran ni se alteran.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2"><JobBadge job={job} /> <Badge variant="muted">Versión lógica {job.version_number}</Badge></div>{canExport ? <Button disabled={!job.approved_at} onClick={() => void finalExport()}><Download /> Descargar Excel final</Button> : null}{!job.approved_at ? <p className="text-sm text-muted-foreground">El resultado final estará disponible al aprobar la conciliación.</p> : null}</CardContent></Card><SourceFiles companyId={companyId} projectId={projectId} job={{ ...job, files: existing }} /></div>;
}

export function ElongationWizard({ companyId, projectId, job, onCreated, onBack }: { companyId: string; projectId: string; job?: ElongationJobV2; onCreated: (job: ElongationJobV2) => void; onBack: () => void }) {
  const [step, setStep] = useState<WizardStep>(job ? 'theory' : 'sources');
  const queryClient = useQueryClient();
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['elongation-job', companyId, projectId, job?.id] }); void queryClient.invalidateQueries({ queryKey: ['elongation-jobs', companyId, projectId] }); };
  if (!job) return <SourceForm companyId={companyId} projectId={projectId} onCreated={onCreated} />;
  const content = {
    sources: <SourceFiles companyId={companyId} projectId={projectId} job={job} />,
    theory: <TheoryStep companyId={companyId} projectId={projectId} job={job} refresh={refresh} />,
    review: <TheoryReview companyId={companyId} projectId={projectId} job={job} refresh={refresh} />,
    theoretical: <TheoryExport companyId={companyId} projectId={projectId} job={job} refresh={refresh} />,
    measurements: <MeasurementsStep companyId={companyId} projectId={projectId} job={job} refresh={refresh} />,
    reconcile: <Reconciliation companyId={companyId} projectId={projectId} job={job} refresh={refresh} />,
    approval: <FinalApproval companyId={companyId} projectId={projectId} job={job} refresh={refresh} />,
    result: <ResultStep companyId={companyId} projectId={projectId} job={job} refresh={refresh} />,
  };
  return <div className="space-y-4"><div className="flex items-center justify-between gap-2"><div><p className="text-lg font-semibold">{job.title}</p><ProgressLine job={job} /></div><Button size="sm" variant="outline" onClick={onBack}>Todos los trabajos</Button></div><div className="overflow-x-auto"><div className="flex min-w-max gap-1 rounded-md bg-muted p-1">{STEPS.map((current) => <Button key={current.id} size="sm" variant={step === current.id ? 'default' : 'ghost'} onClick={() => setStep(current.id)}>{current.label}</Button>)}</div></div>{content[step]}</div>;
}
