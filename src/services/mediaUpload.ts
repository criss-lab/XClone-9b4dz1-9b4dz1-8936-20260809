import { supabase } from '@/lib/supabase';

const MAX_DIRECT_UPLOAD_BYTES = 20 * 1024 * 1024;
const DEFAULT_API_BASE = 'https://api.testagram.site/api';

type MediaType = 'image' | 'video' | 'audio' | 'document';

type UploadResponse = {
  id: string;
  storage: 'cloudflare-r2';
  storageKey: string;
  url: string;
  byteSize: number;
  mediaType: MediaType;
  mimeType: string;
};

function apiBase() {
  return (import.meta.env.VITE_CLOUDFLARE_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');
}

function absoluteMediaUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = apiBase().replace(/\/api\/?$/, '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function uploadMediaToR2(file: File, mediaType: MediaType): Promise<UploadResponse> {
  if (!file || file.size <= 0) throw new Error('The selected file is empty.');
  if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
    throw new Error('This media file is larger than the 20 MiB production upload limit.');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');

  const response = await fetch(`${apiBase()}/media`, {
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
  try { payload = await response.json(); } catch { /* preserve the HTTP failure below */ }

  if (!response.ok) {
    throw new Error(payload?.error || `Media upload failed (${response.status})`);
  }
  if (!payload?.id || !payload?.url) {
    throw new Error('Media upload completed without a usable asset URL.');
  }

  return {
    id: payload.id,
    storage: 'cloudflare-r2',
    storageKey: payload.storageKey || payload.storage_key || '',
    url: absoluteMediaUrl(payload.url),
    byteSize: Number(payload.byteSize || file.size),
    mediaType: payload.mediaType || mediaType,
    mimeType: payload.mimeType || file.type || 'application/octet-stream',
  };
}
