import { Link } from 'react-router-dom';
import { ChevronRight, LogOut, ShieldCheck, User } from 'lucide-react';
import { SECONDARY_NAV } from '@/components/layout/nav';
import { useMe } from '@/auth/useMe';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function MorePage() {
  const { data: me } = useMe();
  const { signOut } = useAuth();

  const links = [
    { label: 'Perfil', to: '/perfil', icon: User, soon: false },
    ...(me?.is_platform_admin
      ? [{ label: 'Plataforma', to: '/plataforma', icon: ShieldCheck, soon: false }]
      : []),
    ...SECONDARY_NAV.map((item) => ({ label: item.label, to: item.to, icon: item.icon, soon: item.comingSoon })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Mas opciones" />
      <Card>
        <CardContent className="divide-y p-0">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted"
            >
              <span className="flex items-center gap-3">
                <link.icon className="h-5 w-5 text-primary" />
                {link.label}
              </span>
              <span className="flex items-center gap-2">
                {link.soon ? <Badge variant="warning" className="text-[10px]">Pronto</Badge> : null}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Button variant="outline" className="w-full" onClick={() => void signOut()}>
        <LogOut className="h-4 w-4" /> Cerrar sesion
      </Button>
    </div>
  );
}
