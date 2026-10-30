import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/context/CompanyProvider';
import { projectsApi } from '@/lib/api/projects';
import { Button } from '@/components/ui/button';

export function ProjectArchiveStatus({ companyId, projectId }: { companyId: string; projectId: string }) {
  const { activeMembership } = useCompany();
  const client = useQueryClient();
  const key = ['archive-status', companyId, projectId];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => projectsApi.archiveStatus(companyId, projectId, signal) });
  const archive = useMutation({
    mutationFn: async () => {
      let result;
      do {
        result = await projectsApi.archiveStep(companyId, projectId);
        client.setQueryData(key, result);
      } while (!result.complete);
    },
    onSettled: () => { void query.refetch(); void client.invalidateQueries({ queryKey: ['project-files', companyId, projectId] }); },
  });
  const administrator = ['owner', 'admin'].includes(activeMembership?.role ?? '');
  return <section className="space-y-2 rounded-xl border bg-muted/30 p-4" aria-live="polite">
    <h2 className="font-semibold">Archivos de obra inactiva</h2>
    <p className="text-sm">{query.isPending ? 'Comprobando archivos…' : query.isError ? 'No se pudo comprobar el archivado.' : query.data.complete ? `Compresión verificada. Ahorro: ${(query.data.saved_bytes / 1024 / 1024).toFixed(2)} MB.` : `${query.data.pending} archivos pendientes de verificar o comprimir.`}</p>
    <p className="text-xs text-muted-foreground">Los originales se recuperan íntegros al abrir o descargar. Si un archivo no reduce su tamaño, se conserva sin comprimir. Las carpetas de documentos usan Drive; los planos antiguos conservan su almacenamiento, con compresión cuando corresponde.</p>
    {archive.isError ? <p role="alert" className="text-sm text-destructive">{archive.error.message} Los archivos ya verificados siguen disponibles; puedes reanudar.</p> : null}
    {administrator && !query.data?.complete ? <Button variant="outline" disabled={archive.isPending || !query.isSuccess} onClick={() => archive.mutate()}>{archive.isPending ? 'Verificando y comprimiendo…' : 'Reanudar compresión'}</Button> : null}
    {query.isError ? <Button onClick={() => void query.refetch()}>Reintentar consulta</Button> : null}
  </section>;
}
