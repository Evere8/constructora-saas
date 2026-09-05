import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { roleLabel } from '@/auth/permissions';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { membersApi } from '@/lib/api/modules';
import type { Role } from '@/types/api';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const schema = z.object({ email: z.string().email('Correo inválido'), full_name: z.string().min(2, 'Ingrese el nombre').max(180), role: z.enum(['admin', 'engineer', 'supervisor', 'warehouse', 'transport', 'worker', 'viewer']) });
type FormValues = z.infer<typeof schema>;
const ROLES: Role[] = ['admin', 'engineer', 'supervisor', 'warehouse', 'transport', 'worker', 'viewer'];

export function PersonnelPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const canEdit = useCan('members.edit');
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', full_name: '', role: 'worker' } });
  const query = useQuery({ queryKey: ['members', companyId], queryFn: ({ signal }) => membersApi.list(companyId, signal), enabled: Boolean(companyId) });
  const createMutation = useMutation({
    mutationFn: (values: FormValues) => membersApi.create(companyId, values),
    onSuccess: (member) => { toast.success(member.invitation_sent ? 'Invitación enviada' : 'Personal agregado'); form.reset(); void queryClient.invalidateQueries({ queryKey: ['members', companyId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => membersApi.update(companyId, id, { role }),
    onSuccess: () => { toast.success('Rol actualizado'); void queryClient.invalidateQueries({ queryKey: ['members', companyId] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  return <div className="space-y-6"><div><h1 className="text-2xl font-semibold">Personal</h1><p className="text-sm text-muted-foreground">Invita al equipo de la constructora y define qué puede hacer cada persona.</p></div>
    {canEdit ? <Card><CardContent className="p-4"><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_220px_auto] lg:items-end" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}><div className="space-y-1"><Label htmlFor="member-name">Nombre</Label><Input id="member-name" {...form.register('full_name')} />{form.formState.errors.full_name ? <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p> : null}</div><div className="space-y-1"><Label htmlFor="member-email">Correo</Label><Input id="member-email" type="email" {...form.register('email')} />{form.formState.errors.email ? <p className="text-xs text-destructive">{form.formState.errors.email.message}</p> : null}</div><div className="space-y-1"><Label>Rol</Label><Select value={form.watch('role')} onValueChange={(value) => form.setValue('role', value as FormValues['role'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}</SelectContent></Select></div><Button type="submit" disabled={createMutation.isPending}><UserPlus className="h-4 w-4" /> Invitar</Button></form></CardContent></Card> : null}
    {query.isLoading ? <LoadingState label="Cargando personal..." /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data?.length ? <div className="grid gap-3 md:grid-cols-2">{query.data.map((member) => <Card key={member.id}><CardContent className="space-y-3 p-4"><div className="flex items-start justify-between"><div><p className="font-medium">{member.full_name || member.email}</p><p className="text-xs text-muted-foreground">{member.email}</p></div><Badge variant={member.status === 'active' ? 'success' : 'muted'}>{member.status === 'active' ? 'Activo' : member.status}</Badge></div><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{member.assigned_tasks} tareas · {member.assigned_checklist} controles</p>{canEdit && member.role !== 'owner' ? <Select value={member.role} onValueChange={(role) => updateMutation.mutate({ id: member.id, role: role as Role })}><SelectTrigger className="h-8 w-[175px]"><SelectValue /></SelectTrigger><SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}</SelectContent></Select> : <Badge variant="outline">{roleLabel(member.role)}</Badge>}</div></CardContent></Card>)}</div> : <EmptyState title="Sin personal" description="Invita a la primera persona de la constructora." icon={<Users className="h-6 w-6" />} />}
  </div>;
}
