import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Search } from 'lucide-react';
import { projectsApi } from '@/lib/api/projects';
import type { Project, ProjectStatus } from '@/types/api';
import { useCompany } from '@/context/CompanyProvider';
import { useCan } from '@/auth/useCan';
import { useDebounce } from '@/lib/useDebounce';
import { asItems, asTotal } from '@/lib/collection';
import { PROJECT_STATUS, PROJECT_STATUS_OPTIONS } from '@/lib/labels';
import { formatDate } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/common/states';
import { ProjectFormDialog } from '@/pages/projects/ProjectFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 10;
const ALL = 'all';

export function ProjectsListPage() {
  const { activeCompanyId } = useCompany();
  const canEdit = useCan('projects.edit');
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProjectStatus | typeof ALL>(ALL);
  const [page, setPage] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | undefined>(undefined);

  const debouncedSearch = useDebounce(search);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status === ALL ? undefined : status,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [debouncedSearch, status, page],
  );

  const query = useQuery({
    queryKey: ['projects', activeCompanyId, filters],
    queryFn: ({ signal }) => projectsApi.list(activeCompanyId as string, filters, signal),
    enabled: Boolean(activeCompanyId),
    placeholderData: keepPreviousData,
  });

  const projects = asItems(query.data);
  const total = asTotal(query.data);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (project: Project) => {
    setEditing(project);
    setDialogOpen(true);
  };

  if (!activeCompanyId) {
    return (
      <EmptyState
        title="Sin constructora activa"
        description="Selecciona una constructora para ver sus obras."
        icon={<Building2 className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Obras"
        description="Administra las obras de tu constructora."
        actions={
          canEdit ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Nueva obra
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar por nombre o codigo..."
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as ProjectStatus | typeof ALL);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            {PROJECT_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {query.isLoading ? (
            <LoadingState label="Cargando obras..." />
          ) : query.isError ? (
            <div className="p-6">
              <ErrorState error={query.error} onRetry={() => void query.refetch()} />
            </div>
          ) : projects.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No hay obras"
                description={
                  debouncedSearch || status !== ALL
                    ? 'No se encontraron obras con los filtros aplicados.'
                    : 'Crea tu primera obra para comenzar.'
                }
                action={
                  canEdit ? (
                    <Button onClick={openCreate} size="sm">
                      <Plus className="h-4 w-4" /> Nueva obra
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Obra</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden sm:table-cell">Inicio</TableHead>
                  <TableHead className="hidden sm:table-cell">Fin</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => {
                  const statusInfo = PROJECT_STATUS[project.status];
                  return (
                    <TableRow
                      key={project.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/obras/${project.id}`)}
                    >
                      <TableCell>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-xs text-muted-foreground">{project.code || 'Sin codigo'}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusInfo?.variant ?? 'muted'}>
                          {statusInfo?.label ?? project.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {formatDate(project.start_date)}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {formatDate(project.planned_end_date)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {canEdit ? (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(project)}>
                            <Pencil className="h-4 w-4" /> Editar
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/obras/${project.id}`)}>
                            Ver
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Pagina {page + 1} de {totalPages} - {total} obras
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <ProjectFormDialog
          key={editing?.id ?? 'new'}
          companyId={activeCompanyId}
          project={editing}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </div>
  );
}
