import { describe, expect, it } from 'vitest';
import { supabaseAuthOptions } from '@/lib/supabase';

describe('configuracion de Supabase Auth', () => {
  it('acepta la sesion temporal de invitaciones generadas por el backend', () => {
    expect(supabaseAuthOptions.flowType).toBe('implicit');
    expect(supabaseAuthOptions.detectSessionInUrl).toBe(true);
    expect(supabaseAuthOptions.persistSession).toBe(true);
  });
});
