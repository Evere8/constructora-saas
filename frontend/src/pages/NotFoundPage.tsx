import { Link } from 'react-router-dom';
import { HardHat } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <HardHat className="h-7 w-7" />
      </div>
      <div>
        <p className="text-4xl font-semibold">404</p>
        <p className="text-muted-foreground">La pagina que buscas no existe.</p>
      </div>
      <Button asChild>
        <Link to="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}
