// Browser-safe monetization configuration.
// Privileged provider credentials are owned by Supabase Edge Functions and
// must never be read from client-side environment variables.

export type MonetizationConfig = {
  supabaseUrl: string;
  edgeFunctionsBaseUrl: string;
  environment: 'development' | 'production';
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';

export const config: MonetizationConfig = {
  supabaseUrl,
  edgeFunctionsBaseUrl: supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1` : '',
  environment: import.meta.env.MODE === 'production' ? 'production' : 'development',
};
