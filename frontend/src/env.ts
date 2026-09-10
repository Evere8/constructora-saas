export interface AppEnv {
  appName: string;
  apiBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

const readEnv = (): AppEnv => ({
  appName: import.meta.env.VITE_APP_NAME || 'Obrixapy',
  // In production the frontend nginx proxies this path to the API container.
  // Keeping it on the same origin avoids a fragile dependency on the public
  // api subdomain and its CORS/TLS configuration.
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_placeholder',
});

export const env: AppEnv = readEnv();
