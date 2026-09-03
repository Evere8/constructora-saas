import { createClient } from '@supabase/supabase-js';
import { env } from '@/env';

export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'obrixapy.auth',
    flowType: 'pkce',
  },
});
