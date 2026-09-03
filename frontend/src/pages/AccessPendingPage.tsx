import { Clock, Lock, AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Variant = 'pending' | 'blocked' | 'error';

const CONTENT: Record<Variant, { icon: typeof Clock; title: string; description: string }> = {
  pending: {
    icon: Clock,
    title: 'Acceso pendiente de activacion',
    description:
      'Tu cuenta existe pero aun no esta activa. Un administrador debe habilitar tu acceso o asignarte a una constructora.',
  },
  blocked: {
    icon: Lock,
    title: 'Cuenta sin acceso',
    description:
      'Tu cuenta esta bloqueada o no tiene una membresia activa en ninguna constructora. Contacta al administrador de plataforma.',
  },
  error: {
    icon: AlertTriangle,
    title: 'No pudimos verificar tu acceso',
    description: 'Ocurrio un problema al consultar tu perfil. Intenta nuevamente en unos segundos.',
  },
};

export function AccessPendingPage({
  variant,
  message,
  onRetry,
}: {
  variant: Variant;
  message?: string;
  onRetry?: () => void;
}) {
  const { signOut } = useAuth();
  const content = CONTENT[variant];
  const Icon = content.icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Icon className="h-7 w-7" />
          </div>
          <CardTitle>{content.title}</CardTitle>
          <CardDescription>{message ?? content.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {variant === 'error' && onRetry ? (
            <Button onClick={onRetry} className="w-full">
              <RefreshCw className="h-4 w-4" /> Reintentar
            </Button>
          ) : null}
          <Button variant="outline" className="w-full" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" /> Cerrar sesion
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
