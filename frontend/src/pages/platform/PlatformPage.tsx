import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { platformApi } from '@/lib/api/platform';
import type {
  Company,
  CompanyOnboardingResult,
  Plan,
  PlatformMembership,
  Role,
} from '@/types/api';
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
const MEMBERSHIP_STATUS_OPTIONS = ['active', 'invited', 'blocked'];

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
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [maxProjects, setMaxProjects] = useState(
    plan?.limits_json.active_projects?.toString() ?? '',
  );
  const [maxUsers, setMaxUsers] = useState(plan?.limits_json.users?.toString() ?? '');
  const [storageGb, setStorageGb] = useState(plan?.limits_json.storage_gb?.toString() ?? '');
  const [monthlyUploads, setMonthlyUploads] = useState(
    plan?.limits_json.monthly_plan_uploads?.toString() ?? '',
  );
  const [active, setActive] = useState(plan?.is_active === false ? 'no' : 'yes');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const limits_json = {
        active_projects: Number(maxProjects),
        users: Number(maxUsers),
        storage_gb: Number(storageGb),
        monthly_plan_uploads: Number(monthlyUploads),
      };
      const payload = {
        name,
        limits_json,
        is_active: active === 'yes',
      };
      return plan
        ? platformApi.updatePlan(plan.id, payload)
        : platformApi.createPlan({ code, ...payload });
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
          {!plan ? (
            <div className="space-y-2">
              <Label>Código</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase())}
                placeholder="profesional"
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Max. obras</Label>
              <Input type="number" value={maxProjects} onChange={(e) => setMaxProjects(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Max. usuarios</Label>
              <Input type="number" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Almacenamiento (GB)</Label>
              <Input type="number" value={storageGb} onChange={(e) => setStorageGb(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Planos por mes</Label>
              <Input type="number" value={monthlyUploads} onChange={(e) => setMonthlyUploads(e.target.value)} />
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
          <Button
            disabled={
              !name ||
              (!plan && !code) ||
              !maxProjects ||
              !maxUsers ||
              !storageGb ||
              !monthlyUploads ||
              mutation.isPending
            }
            onClick={() => { setError(null); mutation.mutate(); }}
          >
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
                  <TableHead>Código</TableHead>
                  <TableHead>Obras</TableHead>
                  <TableHead>Usuarios</TableHead>
                  <TableHead>Almacenamiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell className="font-medium">{plan.name}</TableCell>
                    <TableCell>{plan.code}</TableCell>
                    <TableCell>{plan.limits_json.active_projects ?? '\u2014'}</TableCell>
                    <TableCell>{plan.limits_json.users ?? '\u2014'}</TableCell>
                    <TableCell>{plan.limits_json.storage_gb ?? '\u2014'} GB</TableCell>
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
  const plansQuery = useQuery({
    queryKey: ['platform-plans'],
    queryFn: ({ signal }) => platformApi.listPlans(signal),
  });
  const plans = asItems(plansQuery.data).filter(
    (plan) => plan.is_active || plan.id === company?.plan_id,
  );
  const [name, setName] = useState(company?.name ?? '');
  const [slug, setSlug] = useState(company?.slug ?? '');
  const [planId, setPlanId] = useState(company?.plan_id ?? '');
  const [status, setStatus] = useState(company?.status ?? 'active');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation<Company | CompanyOnboardingResult>({
    mutationFn: () =>
      company
        ? platformApi.updateCompany(company.id, {
            name,
            slug: slug || null,
            plan_id: planId || null,
            status,
          })
        : platformApi.onboardCompany({
            name,
            slug,
            plan_id: planId || undefined,
            status,
            owner_email: ownerEmail,
            owner_full_name: ownerName,
          }),
    onSuccess: (result) => {
      const invited = 'owner' in result && result.owner.invitation_sent;
      toast.success(
        company
          ? 'Constructora actualizada'
          : invited
            ? 'Constructora creada. Enviamos la invitación al propietario.'
            : 'Constructora creada y propietario asignado.',
      );
      void queryClient.invalidateQueries({ queryKey: ['platform-companies'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-memberships'] });
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
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="mi-constructora"
            />
          </div>
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder="Selecciona un plan" /></SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                ))}
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
          {!company ? (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="mb-3 text-sm font-semibold">Propietario de la constructora</p>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Nombre completo</Label>
                  <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Correo</Label>
                  <Input
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="propietario@constructora.com"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Si la cuenta no existe, recibirá un correo para definir su contraseña.
                </p>
              </div>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={
              !name ||
              !slug ||
              !planId ||
              (!company && (!ownerName || !ownerEmail)) ||
              mutation.isPending
            }
            onClick={() => { setError(null); mutation.mutate(); }}
          >
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
  const [fullName, setFullName] = useState(membership?.full_name ?? '');
  const [role, setRole] = useState<Role>(membership?.role ?? 'viewer');
  const [status, setStatus] = useState(membership?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      isEdit && membership
        ? platformApi.updateMembership(membership.id, { role, status })
        : platformApi.createMembership(companyId, {
            email,
            full_name: fullName || undefined,
            role,
            status,
          }),
    onSuccess: (result) => {
      toast.success(
        isEdit
          ? 'Membresía actualizada'
          : result.invitation_sent
            ? 'Usuario invitado y membresía creada'
            : 'Membresía creada',
      );
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
            <>
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Correo del usuario</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </>
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
                {MEMBERSHIP_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
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
