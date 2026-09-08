import { createClient } from '@supabase/supabase-js';

// Production-safe public runtime fallback. These are intentionally non-secret
// Supabase client values: publishable/anon keys are designed for browser use
// and remain constrained by Supabase RLS. Vite replaces VITE_* variables at
// build time, so a Vercel deployment with missing environment configuration
// must not crash before React starts.
const PRODUCTION_SUPABASE_URL = 'https://zcjtvykwwplnzyyslnop.supabase.co';
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_LYmosWe1b1cqFyyd8qaCQg_WIFjgoqQ';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || PRODUCTION_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Testagram backend is not configured: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.');
}

// The schema is intentionally dynamic across the social feature set. The
// runtime Supabase client remains unchanged; this compatibility type prevents
// stale generated database typings from rejecting valid PostgREST thenables.
export const supabase: any = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// The Testagram custom-domain /api route is currently being repaired at the
// DNS/Cloudflare edge. Keep the deployed Worker as the deterministic fallback
// so production clients never fall back to localhost or an unavailable origin.
const DIRECT_CLOUDFLARE_API = 'https://testagram-api.nahashonnyaga794.workers.dev/api';
export const cloudflareApiUrl = (import.meta.env.VITE_CLOUDFLARE_API_URL || DIRECT_CLOUDFLARE_API).replace(/\/$/, '');
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export async function cloudflareHealth() {
  const response = await fetch(`${cloudflareApiUrl}/health`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Cloudflare backend health check failed (${response.status})`);
  return response.json();
}

export async function uploadMedia(file: File, mediaType: 'image' | 'video' | 'audio' | 'document') {
  if (file.size <= 0) throw new Error('The selected media file is empty.');
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Media exceeds the 20 MiB limit.');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('You must be signed in to upload media.');

  const response = await fetch(`${cloudflareApiUrl}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Media-Type': mediaType,
      'X-File-Name': file.name,
    },
    body: file,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Media upload failed (${response.status})`);
  return payload as {
    id: string;
    storage: 'cloudflare-r2';
    storageKey: string;
    url: string;
    byteSize: number;
    mediaType: string;
    mimeType: string;
  };
}
