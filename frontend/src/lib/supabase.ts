import { createClient } from '@supabase/supabase-js';
import { env } from '@/env';

export const supabaseAuthOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  storageKey: 'obrixapy.auth',
  // Obrixapy es una SPA. Las invitaciones se generan en el backend, por lo que
  // no existe un code verifier en el navegador invitado; el flujo implícito
  // permite que Supabase entregue y detecte la sesión temporal del enlace.
  flowType: 'implicit' as const,
};

export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: supabaseAuthOptions,
});
