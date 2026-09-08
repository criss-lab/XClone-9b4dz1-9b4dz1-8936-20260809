import { supabase } from '@/lib/supabase';

const API_BASE = (import.meta.env.VITE_CLOUDFLARE_API_URL || 'https://api.testagram.site/api').replace(/\/$/, '');
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export type CloudflareMediaType = 'image' | 'video' | 'audio' | 'document';

export async function uploadMediaToCloudflareR2(file: File, mediaType: CloudflareMediaType) {
  if (file.size <= 0) throw new Error('The selected file is empty.');
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Media exceeds the 20 MiB upload limit.');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('You must be signed in to upload media.');

  const response = await fetch(`${API_BASE}/media`, {
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
  try { payload = await response.json(); } catch { /* response may be empty */ }
  if (!response.ok) throw new Error(payload?.error || `Cloudflare media upload failed (${response.status}).`);

  const relativeUrl = payload?.url || (payload?.id ? `/api/media/${payload.id}` : null);
  if (!relativeUrl) throw new Error('Cloudflare media upload returned no media URL.');

  return {
    ...payload,
    url: relativeUrl.startsWith('http') ? relativeUrl : `${API_BASE.replace(/\/api$/, '')}${relativeUrl}`,
  } as { id: string; url: string; storage: string; storageKey: string; mediaType: CloudflareMediaType; mimeType: string; byteSize: number };
}
