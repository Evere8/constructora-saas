import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCheck, Loader2, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { elongationsApi, readingBusy, type ElongationManualItem } from '@/lib/api/elongations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { ElongationJobV2 } from '@/types/api';

type Props = { companyId: string; projectId: string; job: ElongationJobV2; refresh: () => void };
const fail = (error: unknown) => toast.error(error instanceof Error ? error.message : 'No se pudo guardar.');

export function ReaderStatus({ companyId, projectId }: Pick<Props, 'companyId' | 'projectId'>) {
  const status = useQuery({ queryKey: ['elongation-ocr', companyId, projectId],
    queryFn: () => elongationsApi.ocrStatus(companyId, projectId), staleTime: 30000 });
  if (!status.data) return null;
  return <p className={`rounded-lg border p-3 text-sm ${status.data.visual_enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
    {status.data.visual_enabled
      ? 'Lectura visual conectada a OpenAI: plano completo por recortes y mediciones manuscritas. Los resultados quedan pendientes de revisión.'
      : 'Lectura local activa. Para reconocer las mediciones manuscritas, el administrador debe conectar OpenAI en el servidor. También puedes completar los datos manualmente.'}
  </p>;
}

export function TheoryActions({ companyId, projectId, job, refresh }: Props) {
  const canEdit = useCan('documents.edit');
  const canApprove = useCan('documents.approve');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ElongationManualItem>({ label: '', classification: 'unknown', length_m: '', strand_count: 1, calculated_elongation: '', source_page: 1 });
  const [error, setError] = useState('');
  const reread = useMutation({ mutationFn: () => elongationsApi.rereadTheory(companyId, projectId, job.id), onError: fail,
    onSuccess: () => { toast.success('Relectura iniciada. Se conservan las correcciones y mediciones.'); refresh(); } });
  const create = useMutation({ mutationFn: () => elongationsApi.createItem(companyId, projectId, job.id, draft),
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo agregar.'),
    onSuccess: () => { setOpen(false); setDraft({ label: '', classification: 'unknown', length_m: '', strand_count: 1, calculated_elongation: '', source_page: 1 }); refresh(); } });
  const pending = job.items.filter(item => item.theory_review_status !== 'approved');
  const blocked = pending.filter(item => item.classification === 'unknown' || ['conflict', 'rejected'].includes(item.theory_review_status));
  const review = useMutation({ mutationFn: () => elongationsApi.reviewTheories(companyId, projectId, job.id, pending.map(item => item.id), job.version_number),
    onError: fail, onSuccess: () => { toast.success('Todas las teorías quedaron revisadas.'); refresh(); } });
  const busy = readingBusy(job) || reread.isPending || review.isPending || create.isPending;
  const confirmChange = () => !(job.theory_approved_at || job.approved_at) || window.confirm('Este cambio requiere volver a aprobar la teoría. Se conservan las mediciones y los Excel anteriores. ¿Continuar?');
  const warnings = job.processing_summary_json?.warnings;
  return <div className="space-y-3">
    <ReaderStatus companyId={companyId} projectId={projectId} />
    <div className="flex flex-wrap gap-2">
      {canEdit && <><Button variant="outline" disabled={busy} onClick={() => { setError(''); setOpen(true); }}><Plus /> Agregar teoría faltante</Button>
        <Button variant="outline" disabled={busy} onClick={() => { if (confirmChange()) reread.mutate(); }}><RefreshCw /> Releer plano completo</Button></>}
      {canApprove && <Button disabled={busy || !pending.length || blocked.length > 0} onClick={() => {
        if (window.confirm(`¿Confirmas que revisaste los cuatro campos y la clasificación de las ${pending.length} teorías pendientes?`)) review.mutate();
      }}><CheckCheck /> Revisar todas las teorías ({pending.length})</Button>}
    </div>
    {blocked.length > 0 && <p className="text-sm text-amber-800">Antes de revisar todas, clasifica o resuelve: {blocked.map(item => item.label).join(', ')}.</p>}
    {readingBusy(job) && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Lectura en curso. Puedes volver al listado; el trabajo se sigue procesando.</p>}
    {job.error_message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{job.error_message}</p>}
    {Array.isArray(warnings) && warnings.length > 0 && <details className="rounded-lg border p-3 text-sm"><summary>Observaciones de la lectura ({warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((warning, i) => <li key={i}>{String(warning)}</li>)}</ul></details>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Agregar teoría faltante</DialogTitle><DialogDescription>Copia los cuatro campos del rótulo del plano. Se crearán exactamente S casillas de medición.</DialogDescription></DialogHeader>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); if (confirmChange()) create.mutate(); }}>
        <label><span className="mb-1 block text-sm font-medium">Label del plano</span><Input required placeholder="T203" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
        <label><span className="mb-1 block text-sm font-medium">Clasificación</span><select className="h-10 w-full rounded-md border bg-background px-2" value={draft.classification} onChange={e => setDraft({ ...draft, classification: e.target.value as ElongationManualItem['classification'] })}><option value="unknown">Sin clasificar</option><option value="band">Banda</option><option value="distributed">Distribuido</option></select></label>
        <label><span className="mb-1 block text-sm font-medium">Longitud (m)</span><Input required inputMode="decimal" value={draft.length_m} onChange={e => setDraft({ ...draft, length_m: e.target.value })} /></label>
        <label><span className="mb-1 block text-sm font-medium">S / cantidad de tendones</span><Input required type="number" min={1} max={1000} value={draft.strand_count} onChange={e => setDraft({ ...draft, strand_count: Number(e.target.value) })} /></label>
        <label><span className="mb-1 block text-sm font-medium">Elongación calculada (cm)</span><Input required inputMode="decimal" value={draft.calculated_elongation} onChange={e => setDraft({ ...draft, calculated_elongation: e.target.value })} /></label>
        <label><span className="mb-1 block text-sm font-medium">Página del plano</span><Input required type="number" min={1} max={25} value={draft.source_page} onChange={e => setDraft({ ...draft, source_page: Number(e.target.value) })} /></label>
        {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
        <Button type="submit" disabled={create.isPending} className="sm:col-span-2">{create.isPending ? 'Guardando…' : 'Agregar y crear sus mediciones'}</Button>
      </form>
    </DialogContent></Dialog>
  </div>;
}

export function ScanReadingReview({ companyId, projectId, job, refresh }: Props) {
  const canEdit = useCan('documents.edit');
  const canApprove = useCan('documents.approve');
  const scans = job.files.filter(file => file.kind === 'measurement_scan');
  const [chosen, setChosen] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(false);
  const [url, setUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const file = scans.find(scan => scan.id === chosen) ?? scans[scans.length - 1];
  const fileId = file?.id;
  const retry = useMutation({ mutationFn: () => elongationsApi.retry(companyId, projectId, job.id), onError: fail, onSuccess: refresh });
  const resolve = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => elongationsApi.resolveReadings(companyId, projectId, job.id, id, reason), onError: fail, onSuccess: refresh });
  useEffect(() => {
    if (!preview || !fileId) return;
    let active = true;
    let created = '';
    setUrl(''); setPreviewError('');
    void elongationsApi.preview(companyId, projectId, job.id, fileId, page).then(blob => {
      if (!active) return;
      created = URL.createObjectURL(blob); setUrl(created);
    }).catch(e => { if (active) setPreviewError(e instanceof Error ? e.message : 'No se pudo abrir el escaneo.'); });
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [companyId, projectId, job.id, fileId, page, preview]);
  if (!scans.length) return null;
  return <Card><CardContent className="space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-2"><strong>Escaneos y observaciones</strong>
      {canEdit && <Button size="sm" variant="outline" disabled={!job.theory_approved_at || readingBusy(job) || retry.isPending} onClick={() => {
        if (!job.approved_at || window.confirm('Releer requiere volver a aprobar el resultado final. ¿Continuar?')) retry.mutate();
      }}><RefreshCw /> Releer mediciones guardadas</Button>}
      <Button size="sm" variant="outline" onClick={() => setPreview(!preview)}>{preview ? 'Ocultar escaneo' : 'Comparar con el escaneo'}</Button>
    </div>
    {job.error_message && <p role="alert" className="text-sm text-amber-800">{job.error_message}</p>}
    {readingBusy(job) && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Analizando manuscritos…</p>}
    {scans.map(scan => {
      const info = scan.processing_summary_json ?? {};
      const unknown = Array.isArray(info.unmatched_labels) ? info.unmatched_labels : [];
      const extras = info.extras && typeof info.extras === 'object' ? Object.entries(info.extras) : [];
      const conflicts = Array.isArray(info.conflicts) ? info.conflicts as Record<string, unknown>[] : [];
      const unassigned = Array.isArray(info.unassigned) ? info.unassigned as Record<string, unknown>[] : [];
      const warnings = Array.isArray(info.warnings) ? info.warnings : [];
      const count = unknown.length + extras.length + conflicts.length + unassigned.length;
      if (!count && !warnings.length) return null;
      return <details key={scan.id} open={count > 0 && !info.review_resolved} className="rounded-lg border p-3 text-sm">
        <summary>{scan.original_filename} · {info.review_resolved ? 'Observaciones revisadas' : `${count} observaciones pendientes`}</summary>
        <div className="mt-2 space-y-2">
          {unknown.length > 0 && <p>Labels sin teoría cargada: {unknown.map(String).join(', ')}. Agrégalos en Plano y vuelve a leer este escaneo.</p>}
          {extras.map(([label, values]) => <p key={label}>{label}: lecturas sobrantes {Array.isArray(values) ? values.map(String).join(' · ') : String(values)}.</p>)}
          {conflicts.map((v, i) => <p key={i}>{String(v.label)} · #{String(v.ordinal)}: otra lectura propone {String(v.candidate)} cm. Compara y corrige el campo correspondiente.</p>)}
          {unassigned.map((v, i) => <p key={i}>Sin asociación segura · página {String(v.page)}: {String(v.raw_text)}. Carga los valores en el Label correcto.</p>)}
          {warnings.map((v, i) => <p key={i}>{String(v)}</p>)}
          {canApprove && count > 0 && !info.review_resolved && <Button size="sm" variant="outline" disabled={readingBusy(job) || resolve.isPending} onClick={() => {
            const reason = window.prompt('Después de corregir las mediciones, explica cómo resolviste estas observaciones (mínimo 5 caracteres):');
            if (reason && reason.trim().length >= 5) resolve.mutate({ id: scan.id, reason: reason.trim() });
          }}>Registrar resolución de observaciones</Button>}
        </div>
      </details>;
    })}
    {preview && <div className="space-y-2"><div className="flex gap-2"><select aria-label="Escaneo para comparar" className="h-10 min-w-0 flex-1 rounded-md border bg-background" value={file?.id ?? ''} onChange={e => { setChosen(e.target.value); setPage(1); }}>{scans.map(scan => <option key={scan.id} value={scan.id}>{scan.original_filename}</option>)}</select>
      <Input aria-label="Página del escaneo" className="w-20" type="number" min={1} max={file?.page_count ?? 1} value={page} onChange={e => setPage(Math.min(file?.page_count ?? 1, Math.max(1, Number(e.target.value))))} /></div>
      {previewError ? <p className="text-sm text-destructive">{previewError}</p> : url ? <div className="max-h-[650px] overflow-auto rounded-md border bg-white"><img src={url} alt="Escaneo original de las mediciones manuscritas" className="w-full min-w-[900px]" /></div> : <p className="text-sm">Preparando escaneo…</p>}
    </div>}
  </CardContent></Card>;
}
