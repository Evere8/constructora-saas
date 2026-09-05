import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileScan, FileSpreadsheet, SearchCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { documentsApi, saveBlob } from '@/lib/api/modules';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function DocumentosTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('documents.edit');
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manual, setManual] = useState({ label: '', length: '', strands: '', calculated: '' });
  const query = useQuery({
    queryKey: ['documents', companyId, projectId],
    queryFn: ({ signal }) => documentsApi.list(companyId, projectId, signal),
  });
  const detail = useQuery({
    queryKey: ['document', companyId, projectId, selectedId],
    queryFn: ({ signal }) => documentsApi.get(companyId, projectId, selectedId as string, signal),
    enabled: Boolean(selectedId),
  });
  const processMutation = useMutation({
    mutationFn: () => documentsApi.process(companyId, projectId, title, file as File),
    onSuccess: (job) => {
      toast.success(job.item_count ? `Documento leído: ${job.item_count} filas detectadas` : 'Documento cargado para revisión');
      setTitle(''); setFile(null); setSelectedId(job.id);
      if (inputRef.current) inputRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['documents', companyId, projectId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const updateMutation = useMutation({
    mutationFn: ({ jobId, itemId, input }: { jobId: string; itemId: string; input: { review_status?: 'approved' | 'rejected'; measured_elongation?: string | null } }) =>
      documentsApi.updateItem(companyId, projectId, jobId, itemId, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['document', companyId, projectId, selectedId] }),
    onError: (error: Error) => toast.error(error.message),
  });
  const createItemMutation = useMutation({
    mutationFn: () => documentsApi.createItem(companyId, projectId, selectedId as string, {
      label: manual.label,
      classification: 'distributed',
      length_m: Number(manual.length),
      strand_count: Number(manual.strands),
      calculated_elongation: Number(manual.calculated),
    }),
    onSuccess: () => {
      toast.success('Fila agregada');
      setManual({ label: '', length: '', strands: '', calculated: '' });
      void queryClient.invalidateQueries({ queryKey: ['document', companyId, projectId, selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['documents', companyId, projectId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const download = async (kind: 'source' | 'excel', jobId: string, filename: string) => {
    try {
      const blob = kind === 'source' ? await documentsApi.source(companyId, projectId, jobId) : await documentsApi.excel(companyId, projectId, jobId);
      saveBlob(blob, filename);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo descargar'); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
        <p className="font-medium">PDF o fotografía → lectura automática → revisión → Excel</p>
        <p className="mt-1 text-muted-foreground">El OCR se ejecuta de forma privada en el servidor. Revise las filas detectadas antes de usar el Excel.</p>
      </div>
      {canEdit ? <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5"><Label htmlFor="doc-title">Nombre</Label><Input id="doc-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Planilla de elongaciones" /></div>
        <div className="space-y-1.5"><Label htmlFor="doc-file">PDF o foto escaneada</Label><Input ref={inputRef} id="doc-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div>
        <Button disabled={!title.trim() || !file || processMutation.isPending} onClick={() => processMutation.mutate()}><FileScan className="h-4 w-4" /> {processMutation.isPending ? 'Escaneando...' : 'Escanear'}</Button>
      </CardContent></Card> : null}
      {query.isLoading ? <LoadingState label="Cargando documentos..." /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data?.length ? (
        <div className="space-y-3">{query.data.map((job) => <Card key={job.id}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-medium">{job.title}</p><Badge variant={job.status === 'failed' ? 'destructive' : 'muted'}>{job.status === 'review_required' ? 'Revisar' : job.status}</Badge></div><p className="text-xs text-muted-foreground">{job.original_filename} · {job.item_count} filas</p>{job.error_message ? <p className="mt-1 text-xs text-amber-700">{job.error_message}</p> : null}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedId(job.id)}><SearchCheck className="h-4 w-4" /> Revisar</Button><Button size="sm" variant="outline" onClick={() => void download('source', job.id, job.original_filename || 'documento')}><Download className="h-4 w-4" /> Original</Button><Button size="sm" onClick={() => void download('excel', job.id, `${job.title}.xlsx`)}><FileSpreadsheet className="h-4 w-4" /> Excel</Button></div></CardContent></Card>)}</div>
      ) : <EmptyState title="Sin documentos procesados" description="Carga un PDF o una foto para detectar sus datos y generar un Excel revisable." icon={<FileScan className="h-6 w-6" />} />}

      {selectedId ? <Card><CardContent className="space-y-3 p-4"><div className="flex items-center justify-between"><p className="font-semibold">Filas detectadas</p><Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Cerrar</Button></div>{detail.isLoading ? <LoadingState /> : detail.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Etiqueta</th><th className="p-2">Tipo</th><th className="p-2">Longitud</th><th className="p-2">Cordones</th><th className="p-2">Calculada</th><th className="p-2">Medida</th><th className="p-2">Revisión</th></tr></thead><tbody>{detail.data.items.map((item) => <tr key={item.id} className="border-b"><td className="p-2 font-medium">{item.label}</td><td className="p-2">{item.classification === 'band' ? 'Banda' : 'Distribuida'}</td><td className="p-2">{item.length_m}</td><td className="p-2">{item.strand_count}</td><td className="p-2">{item.calculated_elongation}</td><td className="p-2"><Input aria-label={`Elongación medida de ${item.label}`} className="h-8 w-28" type="number" min="0" step="0.001" defaultValue={item.measured_elongation ?? ''} disabled={!canEdit} onBlur={(event) => updateMutation.mutate({ jobId: selectedId, itemId: item.id, input: { measured_elongation: event.target.value || null } })} /></td><td className="p-2"><div className="flex gap-1"><Button size="sm" variant={item.review_status === 'approved' ? 'default' : 'outline'} disabled={!canEdit} onClick={() => updateMutation.mutate({ jobId: selectedId, itemId: item.id, input: { review_status: 'approved' } })}>Aprobar</Button><Button size="sm" variant={item.review_status === 'rejected' ? 'destructive' : 'outline'} disabled={!canEdit} onClick={() => updateMutation.mutate({ jobId: selectedId, itemId: item.id, input: { review_status: 'rejected' } })}>Rechazar</Button></div></td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No se detectaron filas automáticamente.</p>}{canEdit ? <div className="grid gap-2 border-t pt-3 sm:grid-cols-5"><Input aria-label="Etiqueta manual" placeholder="Etiqueta" value={manual.label} onChange={(event) => setManual((current) => ({ ...current, label: event.target.value }))} /><Input aria-label="Longitud manual" type="number" min="0" step="0.001" placeholder="Longitud" value={manual.length} onChange={(event) => setManual((current) => ({ ...current, length: event.target.value }))} /><Input aria-label="Cordones manual" type="number" min="1" placeholder="Cordones" value={manual.strands} onChange={(event) => setManual((current) => ({ ...current, strands: event.target.value }))} /><Input aria-label="Elongación calculada manual" type="number" min="0" step="0.001" placeholder="Calculada" value={manual.calculated} onChange={(event) => setManual((current) => ({ ...current, calculated: event.target.value }))} /><Button disabled={!manual.label || !manual.length || !manual.strands || !manual.calculated || createItemMutation.isPending} onClick={() => createItemMutation.mutate()}>Agregar fila</Button></div> : null}</CardContent></Card> : null}
    </div>
  );
}
