import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileUp, Folder, FolderPlus, Map, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { plansApi, saveBlob } from '@/lib/api/modules';
import { projectFilesApi } from '@/lib/api/projectFiles';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PlanosTab({
  companyId,
  projectId,
  overviewPlanVersionId,
}: {
  companyId: string;
  projectId: string;
  overviewPlanVersionId: string | null;
}) {
  const canEdit = useCan('plans.edit');
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const foldersQuery = useQuery({ queryKey: ['project-folders', companyId, projectId], queryFn: ({ signal }) => projectFilesApi.folders(companyId, projectId, signal) });
  const filesQuery = useQuery({ queryKey: ['project-files', companyId, projectId], queryFn: ({ signal }) => projectFilesApi.files(companyId, projectId, signal) });
  const folderMutation = useMutation({
    mutationFn: () => projectFilesApi.createFolder(companyId, projectId, folderName.trim(), currentFolder),
    onSuccess: () => { setFolderName(''); toast.success('Carpeta creada'); void queryClient.invalidateQueries({ queryKey: ['project-folders', companyId, projectId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const fileMutation = useMutation({
    mutationFn: () => projectFilesApi.upload(companyId, projectId, documentFile as File, currentFolder),
    onSuccess: () => { setDocumentFile(null); toast.success('Documento guardado en Drive'); void queryClient.invalidateQueries({ queryKey: ['project-files', companyId, projectId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
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
  const overviewMutation = useMutation({
    mutationFn: (versionId: string) => plansApi.setOverview(companyId, projectId, versionId),
    onSuccess: () => {
      toast.success('Plano configurado para el resumen de la obra');
      void queryClient.invalidateQueries({ queryKey: ['project', companyId, projectId] });
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
  const downloadDocument = async (fileId: string, filename: string) => {
    try { saveBlob(await projectFilesApi.download(companyId, projectId, fileId), filename); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo descargar'); }
  };
  const folders = foldersQuery.data ?? [];
  const children = folders.filter((folder) => folder.parent_id === currentFolder);
  const folderFiles = (filesQuery.data ?? []).filter((document) => document.folder_id === currentFolder);
  const current = folders.find((folder) => folder.id === currentFolder);

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-4 p-4"><div><h2 className="font-semibold">Carpetas y documentos de la obra</h2><p className="text-xs text-muted-foreground">Organiza carpetas y subcarpetas. Los nuevos archivos de esta sección se guardan en un Drive operativo independiente de los respaldos, hasta 10 MB por archivo. Los planos interactivos de abajo conservan su almacenamiento y versiones actuales.</p></div><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant={currentFolder ? 'outline' : 'secondary'} onClick={() => setCurrentFolder(null)}>Inicio</Button>{current ? <><Button size="sm" variant="outline" onClick={() => setCurrentFolder(current.parent_id)}>← Volver</Button><span className="text-sm">/ {current.name}</span></> : null}</div>{canEdit ? <div className="flex flex-wrap items-end gap-2"><div><Label>Nombre de carpeta</Label><Input value={folderName} maxLength={180} onChange={(event) => setFolderName(event.target.value)} placeholder="Ej.: Estructuras" /></div><Button variant="outline" disabled={!folderName.trim() || folderMutation.isPending} onClick={() => folderMutation.mutate()}><FolderPlus className="h-4 w-4" /> Crear carpeta</Button><div><Label>Archivo para esta carpeta</Label><Input type="file" onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)} /></div><Button disabled={!documentFile || documentFile.size > 10 * 1024 * 1024 || fileMutation.isPending} onClick={() => fileMutation.mutate()}><FileUp className="h-4 w-4" /> Subir a Drive</Button></div> : null}{documentFile && documentFile.size > 10 * 1024 * 1024 ? <p className="text-xs text-destructive">El límite operativo actual es 10 MB por archivo.</p> : null}{foldersQuery.isError || filesQuery.isError ? <p className="text-sm text-destructive">No se pudo cargar el índice de carpetas.</p> : null}<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{children.map((folder) => <Button key={folder.id} variant="outline" className="justify-start" onClick={() => setCurrentFolder(folder.id)}><Folder className="h-4 w-4" /> {folder.name}</Button>)}{folderFiles.map((document) => <div key={document.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"><span className="truncate" title={document.original_filename}>{document.original_filename} <span className="text-xs text-muted-foreground">({Math.ceil(document.size_bytes / 1024)} KB)</span></span><Button size="sm" variant="ghost" aria-label={`Descargar ${document.original_filename}`} onClick={() => void downloadDocument(document.id, document.original_filename)}><Download className="h-4 w-4" /></Button></div>)}</div>{!children.length && !folderFiles.length ? <p className="text-xs text-muted-foreground">Esta carpeta todavía está vacía.</p> : null}</CardContent></Card>
      <h2 className="font-semibold">Planos interactivos y versiones</h2>
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
                    {latest && canEdit ? (
                      <Button
                        size="sm"
                        variant={overviewPlanVersionId === latest.id ? 'secondary' : 'outline'}
                        disabled={overviewPlanVersionId === latest.id || overviewMutation.isPending}
                        onClick={() => overviewMutation.mutate(latest.id)}
                      >
                        <Eye className="h-4 w-4" />
                        {overviewPlanVersionId === latest.id ? 'En resumen' : 'Mostrar en resumen'}
                      </Button>
                    ) : null}
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
