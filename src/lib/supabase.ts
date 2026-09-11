import { createClient } from '@supabase/supabase-js';

const PRODUCTION_SUPABASE_URL = 'https://aepbqfrmheihfsauzcby.supabase.co';
const configuredSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
// Never allow a relative Vite value such as `/` or `/rest/...` to reach supabase-js.
const supabaseUrl = isHttpUrl(configuredSupabaseUrl) ? configuredSupabaseUrl.replace(/\/$/, '') : PRODUCTION_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabasePublishableKey) {
  throw new Error('Testagram backend is not configured: VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) is required.');
}

const DIRECT_CLOUDFLARE_API = 'https://testagram-api.nahashonnyaga794.workers.dev/api';
const configuredCloudflareApi = String(import.meta.env.VITE_CLOUDFLARE_API_URL || '').trim().replace(/\/$/, '');
export const cloudflareApiUrl = isHttpUrl(configuredCloudflareApi) ? configuredCloudflareApi : DIRECT_CLOUDFLARE_API;
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

const baseClient: any = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function cloudflareHealth() {
  const response = await fetch(`${cloudflareApiUrl}/health`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Cloudflare backend health check failed (${response.status})`);
  return response.json();
}

/** Browser/native WebView -> canonical Cloudflare Worker -> R2 -> media_assets. */
export async function uploadMedia(file: File, mediaType: 'image' | 'video' | 'audio' | 'document') {
  if (file.size <= 0) throw new Error('The selected media file is empty.');
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Media exceeds the 20 MiB limit.');

  const { data: { session } } = await baseClient.auth.getSession();
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

  let payload: any = null;
  try { payload = await response.json(); } catch { /* preserve HTTP failure below */ }
  if (!response.ok) throw new Error(payload?.error || `Media upload failed (${response.status})`);
  if (!payload?.id || !payload?.url) throw new Error('Media upload completed without a usable asset URL.');

  const url = isHttpUrl(String(payload.url))
    ? String(payload.url)
    : `${cloudflareApiUrl.replace(/\/api\/?$/, '')}${String(payload.url).startsWith('/') ? payload.url : `/${payload.url}`}`;

  return {
    id: payload.id,
    storage: 'cloudflare-r2' as const,
    storageKey: payload.storageKey || payload.storage_key || '',
    url,
    byteSize: Number(payload.byteSize || file.size),
    mediaType: payload.mediaType || mediaType,
    mimeType: payload.mimeType || file.type || 'application/octet-stream',
  };
}

const postMediaPublicUrls = new Map<string, string>();
function cloudflarePostsBucket() {
  const fallback = baseClient.storage.from('posts');
  return {
    ...fallback,
    upload: async (path: string, file: File) => {
      const mediaType = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
      const asset = await uploadMedia(file, mediaType);
      postMediaPublicUrls.set(path, asset.url);
      return { data: { path: asset.id, id: asset.id, fullPath: asset.url }, error: null };
    },
    getPublicUrl: (path: string) => {
      const knownUrl = postMediaPublicUrls.get(path);
      if (knownUrl) return { data: { publicUrl: knownUrl } };
      if (/^[0-9a-f-]{36}$/i.test(path)) return { data: { publicUrl: `${cloudflareApiUrl}/media/${path}` } };
      return fallback.getPublicUrl(path);
    },
  };
}

// Preserve existing feature APIs while ensuring the post-media bucket never invokes legacy Supabase media-upload.
export const supabase: any = new Proxy(baseClient, {
  get(target, property, receiver) {
    if (property === 'storage') return { ...target.storage, from(bucket: string) { return bucket === 'posts' ? cloudflarePostsBucket() : target.storage.from(bucket); } };
    return Reflect.get(target, property, receiver);
  },
});
