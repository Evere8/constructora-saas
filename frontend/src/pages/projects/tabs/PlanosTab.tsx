import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Map, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { plansApi, saveBlob } from '@/lib/api/modules';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PlanosTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('plans.edit');
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const query = useQuery({
    queryKey: ['plans', companyId, projectId],
    queryFn: ({ signal }) => plansApi.list(companyId, projectId, signal),
  });
  const createMutation = useMutation({
    mutationFn: () => plansApi.create(companyId, projectId, title, file as File),
    onSuccess: () => {
      toast.success('Plano cargado');
      setTitle('');
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['plans', companyId, projectId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const addVersion = useMutation({
    mutationFn: ({ documentId, version }: { documentId: string; version: File }) =>
      plansApi.addVersion(companyId, projectId, documentId, version),
    onSuccess: () => {
      toast.success('Nueva versión cargada');
      void queryClient.invalidateQueries({ queryKey: ['plans', companyId, projectId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const download = async (versionId: string, filename: string) => {
    try {
      saveBlob(await plansApi.download(companyId, projectId, versionId), filename);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo descargar');
    }
  };

  return (
    <div className="space-y-4">
      {canEdit ? (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="plan-title">Nombre del plano</Label>
              <Input id="plan-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Planta nivel 1" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-file">PDF o imagen</Label>
              <Input ref={inputRef} id="plan-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            <Button disabled={!title.trim() || !file || createMutation.isPending} onClick={() => createMutation.mutate()}>
              <Plus className="h-4 w-4" /> {createMutation.isPending ? 'Cargando...' : 'Cargar plano'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {query.isLoading ? <LoadingState label="Cargando planos..." /> : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {query.data.map((document) => {
            const latest = document.versions[0];
            return (
              <Card key={document.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="font-medium">{document.title}</p><p className="text-xs text-muted-foreground">{latest?.original_filename ?? 'Sin versión'}</p></div>
                    <Badge variant="muted">{document.versions.length} versión(es)</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {latest ? <Button size="sm" variant="outline" onClick={() => void download(latest.id, latest.original_filename)}><Download className="h-4 w-4" /> Descargar</Button> : null}
                    {canEdit ? (
                      <Label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
                        <FileUp className="h-4 w-4" /> Nueva versión
                        <input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const version = event.target.files?.[0]; if (version) addVersion.mutate({ documentId: document.id, version }); event.target.value = ''; }} />
                      </Label>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : <EmptyState title="Sin planos" description="Carga el primer plano de la obra y conserva su historial de versiones." icon={<Map className="h-6 w-6" />} />}
    </div>
  );
}
