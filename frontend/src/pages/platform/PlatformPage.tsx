import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { platformApi } from '@/lib/api/platform';
import type { Company, Plan, PlatformMembership, Role } from '@/types/api';
import { useMe } from '@/auth/useMe';
import { asItems } from '@/lib/collection';
import { roleLabel } from '@/auth/permissions';
import { ApiError } from '@/lib/http';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

const MEMBERSHIP_ROLES: Role[] = [
  'owner',
  'admin',
  'engineer',
  'supervisor',
  'warehouse',
  'worker',
  'transport',
  'viewer',
];
const STATUS_OPTIONS = ['active', 'inactive', 'suspended'];

function statusVariant(status: string): 'success' | 'muted' | 'destructive' {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'destructive';
  return 'muted';
}

function PlanDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan?: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(plan?.name ?? '');
  const [price, setPrice] = useState(plan?.price?.toString() ?? '');
  const [maxProjects, setMaxProjects] = useState(plan?.max_projects?.toString() ?? '');
  const [maxUsers, setMaxUsers] = useState(plan?.max_users?.toString() ?? '');
  const [active, setActive] = useState(plan?.is_active === false ? 'no' : 'yes');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<Plan> = {
        name,
        price: price ? Number(price) : null,
        max_projects: maxProjects ? Number(maxProjects) : null,
        max_users: maxUsers ? Number(maxUsers) : null,
        is_active: active === 'yes',
      };
      return plan ? platformApi.updatePlan(plan.id, payload) : platformApi.createPlan(payload);
    },
    onSuccess: () => {
      toast.success(plan ? 'Plan actualizado' : 'Plan creado');
      void queryClient.invalidateQueries({ queryKey: ['platform-plans'] });
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'No se pudo guardar el plan.'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? 'Editar plan' : 'Nuevo plan'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Precio</Label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Max. obras</Label>
              <Input type="number" value={maxProjects} onChange={(e) => setMaxProjects(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Max. usuarios</Label>
              <Input type="number" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Activo</Label>
            <Select value={active} onValueChange={setActive}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Si</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!name || mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlansTab() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | undefined>(undefined);
  const query = useQuery({ queryKey: ['platform-plans'], queryFn: ({ signal }) => platformApi.listPlans(signal) });
  const plans = asItems(query.data);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setEditing(undefined); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Nuevo plan
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {query.isLoading ? <LoadingState /> : query.isError ? (
            <div className="p-6"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
          ) : plans.length === 0 ? (
            <div className="p-6"><EmptyState title="Sin planes" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Obras</TableHead>
                  <TableHead>Usuarios</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell className="font-medium">{plan.name}</TableCell>
                    <TableCell>{plan.price ?? '\u2014'}</TableCell>
                    <TableCell>{plan.max_projects ?? '\u2014'}</TableCell>
                    <TableCell>{plan.max_users ?? '\u2014'}</TableCell>
                    <TableCell>
                      <Badge variant={plan.is_active === false ? 'muted' : 'success'}>
                        {plan.is_active === false ? 'Inactivo' : 'Activo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(plan); setOpen(true); }}>
                        <Pencil className="h-4 w-4" /> Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <PlanDialog key={editing?.id ?? 'new'} plan={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function CompanyDialog({
  company,
  open,
  onOpenChange,
}: {
  company?: Company;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(company?.name ?? '');
  const [slug, setSlug] = useState(company?.slug ?? '');
  const [status, setStatus] = useState(company?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      company
        ? platformApi.updateCompany(company.id, { name, slug: slug || null, status })
        : platformApi.createCompany({ name, slug: slug || undefined, status }),
    onSuccess: () => {
      toast.success(company ? 'Constructora actualizada' : 'Constructora creada');
      void queryClient.invalidateQueries({ queryKey: ['platform-companies'] });
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'No se pudo guardar.'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{company ? 'Editar constructora' : 'Nueva constructora'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="mi-constructora" />
          </div>
          <div className="space-y-2">
            <Label>Estado</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!name || mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompaniesTab() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | undefined>(undefined);
  const query = useQuery({ queryKey: ['platform-companies'], queryFn: ({ signal }) => platformApi.listCompanies(signal) });
  const companies = asItems(query.data);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setEditing(undefined); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Nueva constructora
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {query.isLoading ? <LoadingState /> : query.isError ? (
            <div className="p-6"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
          ) : companies.length === 0 ? (
            <div className="p-6"><EmptyState title="Sin constructoras" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Constructora</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell className="text-muted-foreground">{company.slug || '\u2014'}</TableCell>
                    <TableCell><Badge variant={statusVariant(company.status)}>{company.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(company); setOpen(true); }}>
                        <Pencil className="h-4 w-4" /> Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <CompanyDialog key={editing?.id ?? 'new'} company={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function MembershipDialog({
  companyId,
  membership,
  open,
  onOpenChange,
}: {
  companyId: string;
  membership?: PlatformMembership;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(membership);
  const [email, setEmail] = useState(membership?.email ?? '');
  const [role, setRole] = useState<Role>(membership?.role ?? 'viewer');
  const [status, setStatus] = useState(membership?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      isEdit && membership
        ? platformApi.updateMembership(membership.id, { role, status })
        : platformApi.createMembership(companyId, { email, role, status }),
    onSuccess: () => {
      toast.success(isEdit ? 'Membresia actualizada' : 'Membresia creada');
      void queryClient.invalidateQueries({ queryKey: ['platform-memberships', companyId] });
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.detail : 'No se pudo guardar.'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar membresia' : 'Nueva membresia'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!isEdit ? (
            <div className="space-y-2">
              <Label>Correo del usuario</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEMBERSHIP_ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Estado</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={(!isEdit && !email) || mutation.isPending}
            onClick={() => { setError(null); mutation.mutate(); }}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembershipsTab() {
  const companiesQuery = useQuery({
    queryKey: ['platform-companies'],
    queryFn: ({ signal }) => platformApi.listCompanies(signal),
  });
  const companies = asItems(companiesQuery.data);
  const [companyId, setCompanyId] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformMembership | undefined>(undefined);

  const query = useQuery({
    queryKey: ['platform-memberships', companyId],
    queryFn: ({ signal }) => platformApi.listMemberships(companyId, signal),
    enabled: Boolean(companyId),
  });
  const memberships = asItems(query.data);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue placeholder="Selecciona una constructora" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {companyId ? (
          <Button size="sm" onClick={() => { setEditing(undefined); setOpen(true); }}>
            <Plus className="h-4 w-4" /> Nueva membresia
          </Button>
        ) : null}
      </div>

      {!companyId ? (
        <EmptyState title="Selecciona una constructora" description="Elige una empresa para ver sus membresias." />
      ) : query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : memberships.length === 0 ? (
        <EmptyState title="Sin membresias" description="Agrega usuarios a esta constructora." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.email || m.user_id || '\u2014'}</TableCell>
                    <TableCell>{roleLabel(m.role)}</TableCell>
                    <TableCell><Badge variant={statusVariant(m.status)}>{m.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(m); setOpen(true); }}>
                        <Pencil className="h-4 w-4" /> Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {companyId ? (
        <MembershipDialog
          key={editing?.id ?? 'new'}
          companyId={companyId}
          membership={editing}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </div>
  );
}

export function PlatformPage() {
  const { data: me } = useMe();

  if (me && !me.is_platform_admin) {
    return (
      <EmptyState
        title="Acceso restringido"
        description="Esta seccion es solo para administradores de plataforma."
        icon={<ShieldAlert className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Plataforma" description="Administra planes, constructoras y membresias." />
      <Tabs defaultValue="empresas">
        <TabsList>
          <TabsTrigger value="empresas">Empresas</TabsTrigger>
          <TabsTrigger value="planes">Planes</TabsTrigger>
          <TabsTrigger value="membresias">Membresias</TabsTrigger>
        </TabsList>
        <TabsContent value="empresas"><CompaniesTab /></TabsContent>
        <TabsContent value="planes"><PlansTab /></TabsContent>
        <TabsContent value="membresias"><MembershipsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
