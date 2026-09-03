import { LogOut } from 'lucide-react';
import { useMe } from '@/auth/useMe';
import { useAuth } from '@/auth/AuthProvider';
import { useCompany } from '@/context/CompanyProvider';
import { roleLabel } from '@/auth/permissions';
import { PageHeader } from '@/components/common/states';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ProfilePage() {
  const { data: me } = useMe();
  const { session, signOut } = useAuth();
  const { activeMembership, memberships } = useCompany();

  const name = me?.full_name || me?.name || 'Usuario';
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Perfil"
        actions={
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" /> Cerrar sesion
          </Button>
        }
      />

      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-lg font-semibold">{name}</p>
            <p className="text-sm text-muted-foreground">{me?.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={me?.status === 'active' ? 'success' : 'warning'}>
                {me?.status === 'active' ? 'Activo' : me?.status ?? 'Desconocido'}
              </Badge>
              {me?.is_platform_admin ? <Badge variant="info">Administrador de plataforma</Badge> : null}
              <Badge variant={session ? 'muted' : 'destructive'}>
                {session ? 'Sesion activa' : 'Sin sesion'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Constructora activa</CardTitle>
        </CardHeader>
        <CardContent>
          {activeMembership ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{activeMembership.name}</p>
                <p className="text-sm text-muted-foreground">{roleLabel(activeMembership.role)}</p>
              </div>
              <Badge variant="success">Activa</Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin constructora activa.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mis membresias</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {memberships.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No tienes membresias activas.</p>
          ) : (
            memberships.map((m) => (
              <div key={m.company_id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{roleLabel(m.role)}</p>
                </div>
                <Badge variant="muted">{m.membership_status}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
