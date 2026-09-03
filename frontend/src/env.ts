export interface AppEnv {
  appName: string;
  apiBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

const readEnv = (): AppEnv => ({
  appName: import.meta.env.VITE_APP_NAME || 'Obrixapy',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'https://api.obrixapy.online/api',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_placeholder',
});

export const env: AppEnv = readEnv();
