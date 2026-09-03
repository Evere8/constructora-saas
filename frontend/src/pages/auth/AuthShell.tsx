import type { ReactNode } from 'react';
import { HardHat } from 'lucide-react';
import { env } from '@/env';

const HERO_IMAGE = 'https://images.unsplash.com/photo-1535732759880-bbd5c7265e3f?auto=format&fit=crop&w=1200&q=80';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-secondary p-10 text-white lg:flex">
        <img
          src={HERO_IMAGE}
          alt="Obra en construccion"
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
            <HardHat className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xl font-semibold">{env.appName}</p>
            <p className="text-sm text-white/70">SaaS para constructoras</p>
          </div>
        </div>
        <div className="relative z-10 max-w-md space-y-3">
          <h2 className="text-3xl font-semibold leading-tight">
            Gestiona tus obras, tareas y checklist en un solo lugar.
          </h2>
          <p className="text-white/70">
            Control multiempresa, seguimiento de avance y trabajo en campo, disenado para el ritmo de
            la construccion.
          </p>
        </div>
      </div>

      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-1/2">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <HardHat className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">{env.appName}</span>
          </div>
          <div className="mb-6 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {children}
          {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
