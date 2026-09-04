import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Download, FileText, Loader2, MessageSquare, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useCanAssigned } from '@/auth/useCan';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { checklistApi } from '@/lib/api/checklist';
import { ApiError } from '@/lib/http';
import { formatDateTime } from '@/lib/utils';
import type { ChecklistEvidence, ChecklistItem } from '@/types/api';

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

function formatBytes(value?: number | null): string {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function EvidenceIcon({ evidence }: { evidence: ChecklistEvidence }) {
  if (evidence.evidence_type === 'photo') return <Camera className="h-5 w-5" />;
  if (evidence.evidence_type === 'document') return <FileText className="h-5 w-5" />;
  return <MessageSquare className="h-5 w-5" />;
}

export function ChecklistEvidenceDialog({
  companyId,
  projectId,
  item,
  open,
  onOpenChange,
}: {
  companyId: string;
  projectId: string;
  item: ChecklistItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const canAddForAssignment = useCanAssigned('checklist.status');
  const canAdd = canAddForAssignment(item.assigned_user_id);
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [fileInputKey, setFileInputKey] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['checklist-evidence', companyId, projectId, item.id],
    queryFn: ({ signal }) => checklistApi.listEvidence(companyId, projectId, item.id, signal),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => checklistApi.createEvidence(companyId, projectId, item.id, { note, file }),
    onSuccess: () => {
      toast.success('Evidencia agregada');
      setNote('');
      setFile(undefined);
      setFileInputKey((value) => value + 1);
      setFormError(null);
      void queryClient.invalidateQueries({
        queryKey: ['checklist-evidence', companyId, projectId, item.id],
      });
    },
    onError: (error) => {
      setFormError(error instanceof ApiError ? error.detail : 'No se pudo guardar la evidencia.');
    },
  });

  const download = async (evidence: ChecklistEvidence) => {
    setDownloadingId(evidence.id);
    try {
      const blob = await checklistApi.downloadEvidence(
        companyId,
        projectId,
        item.id,
        evidence.id,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = evidence.original_filename || 'evidencia';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar la evidencia');
    } finally {
      setDownloadingId(null);
    }
  };

  const evidence = query.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Evidencias</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>

        {canAdd ? (
          <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-2">
              <Label htmlFor="evidence-file">Foto o PDF</Label>
              <Input
                key={fileInputKey}
                id="evidence-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected && selected.size > MAX_EVIDENCE_BYTES) {
                    setFile(undefined);
                    setFormError('El archivo supera el maximo permitido de 10 MB.');
                    event.target.value = '';
                    return;
                  }
                  setFormError(null);
                  setFile(selected);
                }}
              />
              <p className="text-xs text-muted-foreground">Máximo 10 MB por archivo.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-note">Observación</Label>
              <Textarea
                id="evidence-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Describe lo verificado, un problema o una corrección."
                rows={3}
              />
            </div>
            {formError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <Button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || (!file && !note.trim())}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Agregar evidencia
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Historial de evidencias</h3>
          {query.isLoading ? (
            <LoadingState label="Cargando evidencias..." />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : evidence.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Todavía no se agregaron fotos, documentos ni observaciones.
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {evidence.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="mt-0.5 text-primary">
                      <EvidenceIcon evidence={entry} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {entry.original_filename || 'Observación de obra'}
                      </p>
                      {entry.note ? <p className="mt-1 whitespace-pre-wrap text-sm">{entry.note}</p> : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(entry.created_at)}
                        {entry.size_bytes ? ` · ${formatBytes(entry.size_bytes)}` : ''}
                      </p>
                    </div>
                  </div>
                  {entry.original_filename ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void download(entry)}
                      disabled={downloadingId === entry.id}
                    >
                      {downloadingId === entry.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">Descargar</span>
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
