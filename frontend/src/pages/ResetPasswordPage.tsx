import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { AuthShell } from '@/pages/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z
  .object({
    password: z.string().min(8, 'Minimo 8 caracteres'),
    confirm: z.string().min(8, 'Minimo 8 caracteres'),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'Las contrasenas no coinciden',
    path: ['confirm'],
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updatePassword(values.password);
      setDone(true);
      toast.success('Contrasena actualizada.');
      setTimeout(() => navigate('/', { replace: true }), 1200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo actualizar la contrasena.');
    }
  });

  return (
    <AuthShell
      title="Nueva contrasena"
      subtitle="Define una contrasena segura para tu cuenta."
    >
      {done ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Contrasena actualizada. Redirigiendo...
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="password">Nueva contrasena</Label>
            <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmar contrasena</Label>
            <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
            {errors.confirm ? (
              <p className="text-sm text-destructive">{errors.confirm.message}</p>
            ) : null}
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar contrasena
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
