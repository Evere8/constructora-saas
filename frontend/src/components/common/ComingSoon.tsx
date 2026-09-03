import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description ?? 'Este modulo estara disponible en una proxima entrega.'}
        actions={<Badge variant="warning">Proximamente</Badge>}
      />
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Construction className="h-7 w-7" />
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            El contrato de la API para <span className="font-medium text-foreground">{title}</span> aun
            no esta publicado. En cuanto el backend exponga sus endpoints, esta seccion se activara sin
            datos simulados.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
