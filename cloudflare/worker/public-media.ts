interface PublicMediaEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  SUPABASE_ANON_KEY: string;
  APP_ORIGIN: string;
  MEDIA: R2Bucket;
}

function cors(request: Request, env: PublicMediaEnv): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowed = new Set([env.APP_ORIGIN, 'https://testagram.site', 'https://www.testagram.site']);
  return {
    'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : env.APP_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, content-type, range',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    Vary: 'Origin'
  };
}

function json(request: Request, env: PublicMediaEnv, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors(request, env), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function currentUserId(request: Request, env: PublicMediaEnv): Promise<string | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization }
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string };
  return user.id || null;
}

function matchesMediaUrl(value: unknown, id: string): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized === `/api/media/${id}` ||
    normalized === `https://api.testagram.site/api/media/${id}` ||
    normalized.endsWith(`/api/media/${id}`);
}

async function isPublicPostMedia(env: PublicMediaEnv, ownerId: string, id: string): Promise<boolean> {
  const target = new URL(`${env.SUPABASE_URL}/rest/v1/posts`);
  target.searchParams.set('select', 'id,media_urls');
  target.searchParams.set('author_id', `eq.${ownerId}`);
  target.searchParams.set('visibility', 'eq.public');
  target.searchParams.set('deleted_at', 'is.null');
  target.searchParams.set('limit', '100');

  const response = await fetch(target, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) return false;

  const posts = await response.json() as Array<{ media_urls?: unknown }>;
  return posts.some((post) => {
    const urls = Array.isArray(post.media_urls) ? post.media_urls : [];
    return urls.some((url) => matchesMediaUrl(url, id));
  });
}

export async function getPublicMedia(request: Request, env: PublicMediaEnv, id: string): Promise<Response> {
  const metadataUrl = new URL(`${env.SUPABASE_URL}/rest/v1/media_assets`);
  metadataUrl.searchParams.set('select', 'storage_key,mime_type,owner_id,byte_size');
  metadataUrl.searchParams.set('id', `eq.${id}`);
  metadataUrl.searchParams.set('limit', '1');

  const metadataResponse = await fetch(metadataUrl, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Accept: 'application/json'
    }
  });
  if (!metadataResponse.ok) return json(request, env, { error: 'Media metadata lookup failed' }, 502);

  const rows = await metadataResponse.json() as Array<{
    storage_key: string;
    mime_type?: string;
    owner_id: string;
    byte_size: number;
  }>;
  const asset = rows[0];
  if (!asset) return json(request, env, { error: 'Media not found' }, 404);

  const userId = await currentUserId(request, env);
  const isOwner = Boolean(userId && userId === asset.owner_id);
  if (!isOwner && !(await isPublicPostMedia(env, asset.owner_id, id))) {
    return json(request, env, { error: 'Media access denied' }, 403);
  }

  const object = await env.MEDIA.get(asset.storage_key);
  if (!object) return json(request, env, { error: 'Media object not found' }, 404);

  const headers = new Headers(cors(request, env));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Type', asset.mime_type || object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Length', String(asset.byte_size));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(object.body, { status: 200, headers });
}
