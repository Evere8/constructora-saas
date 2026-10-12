import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Moon, Save, Sun } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCan } from '@/auth/useCan';
import { useCompany } from '@/context/CompanyProvider';
import { useTheme } from '@/context/ThemeProvider';
import { settingsApi } from '@/lib/api/modules';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z.object({ name: z.string().min(2, 'Ingrese el nombre').max(180) });

export function SettingsPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const canEdit = useCan('members.edit');
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });
  const query = useQuery({
    queryKey: ['settings', companyId],
    queryFn: ({ signal }) => settingsApi.get(companyId, signal),
    enabled: Boolean(companyId),
  });
  useEffect(() => {
    if (query.data) form.reset({ name: query.data.name });
  }, [form, query.data]);
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => settingsApi.update(companyId, values),
    onSuccess: () => {
      toast.success('Configuración guardada');
      void queryClient.invalidateQueries({ queryKey: ['settings', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading) return <LoadingState label="Cargando configuración..." />;
  if (query.isError || !query.data) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="text-sm text-muted-foreground">Preferencias de la constructora y del equipo.</p>
      </div>

      <Card className="surface-solid">
        <CardHeader>
          <CardTitle className="text-base">Visualización</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Modo de trabajo</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              Claro de alta visibilidad para obra y oscuro para revisar en oficina. La elección se guarda en este dispositivo.
            </p>
          </div>
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`rounded-xl border p-4 text-left transition ${theme === 'light' ? 'border-primary bg-primary/10 ring-2 ring-primary/25' : 'hover:border-primary/50'}`}
            >
              <span className="flex items-center gap-2 font-semibold"><Sun className="h-4 w-4 text-primary" /> Claro de obra</span>
              <span className="mt-1 block text-xs text-muted-foreground">Paneles blancos sólidos y contrastados para tablets al sol.</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`rounded-xl border p-4 text-left transition ${theme === 'dark' ? 'border-primary bg-primary/10 ring-2 ring-primary/25' : 'hover:border-primary/50'}`}
            >
              <span className="flex items-center gap-2 font-semibold"><Moon className="h-4 w-4 text-primary" /> Oscuro de oficina</span>
              <span className="mt-1 block text-xs text-muted-foreground">Menos brillo para lectura, revisión y planificación en escritorio.</span>
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="surface-solid">
        <CardHeader><CardTitle className="text-base">Constructora</CardTitle></CardHeader>
        <CardContent>
          <form className="max-w-xl space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            <div className="space-y-2">
              <Label htmlFor="company-name">Nombre</Label>
              <Input id="company-name" disabled={!canEdit} {...form.register('name')} />
              {form.formState.errors.name ? <p className="text-sm text-destructive">{form.formState.errors.name.message}</p> : null}
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><p className="text-muted-foreground">Identificador</p><p className="font-medium">{query.data.slug}</p></div>
              <div><p className="text-muted-foreground">Estado</p><Badge variant="success">{query.data.status}</Badge></div>
            </div>
            {canEdit ? <Button type="submit" disabled={mutation.isPending}><Save className="h-4 w-4" /> Guardar</Button> : <p className="text-sm text-muted-foreground">Solo propietarios y administradores pueden modificar estos datos.</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
