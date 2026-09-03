import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { AuthShell } from '@/pages/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z.object({
  email: z.string().min(1, 'El correo es obligatorio').email('Correo invalido'),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await sendPasswordReset(values.email);
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar el correo.');
    }
  });

  return (
    <AuthShell
      title="Recuperar contrasena"
      subtitle="Te enviaremos un enlace para restablecerla."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Volver a iniciar sesion
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <MailCheck className="mt-0.5 h-5 w-5" />
            <div>
              <p className="font-medium">Correo enviado</p>
              <p>
                Si <span className="font-medium">{getValues('email')}</span> tiene una cuenta,
                recibiras un enlace para restablecer tu contrasena.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Correo electronico</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="tu@constructora.com"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            {errors.email ? <p className="text-sm text-destructive">{errors.email.message}</p> : null}
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
