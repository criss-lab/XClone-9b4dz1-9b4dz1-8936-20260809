interface Env {
  SUPABASE_URL: string;
  SUPABASE_PROJECT_REF: string;
  SUPABASE_ANON_KEY: string;
  APP_ORIGIN: string;
  MEDIA: R2Bucket;
}

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const TABLES = new Set([
  'ai_usage', 'audio_spaces', 'blocks', 'bookmark_folder_items', 'bookmark_folders', 'bookmarks',
  'communities', 'community_members', 'content_events', 'conversation_members', 'conversations',
  'creator_earnings', 'creator_programs', 'follows', 'follow_requests', 'hashtags', 'list_followers',
  'list_members', 'lists', 'live_streams', 'message_attachments', 'message_pins', 'message_reactions',
  'message_requests', 'messages', 'mutes', 'notifications', 'pinned_posts', 'poll_options', 'poll_votes',
  'polls', 'post_analytics', 'post_drafts', 'post_hashtags', 'post_likes', 'post_media', 'post_products',
  'post_quotes', 'post_replies', 'post_reposts', 'post_translations', 'post_views', 'posts', 'products',
  'profile_analytics_daily', 'profiles', 'recommendation_feedback', 'reel_events', 'reel_sounds', 'reels',
  'reports', 'scheduled_posts', 'space_members', 'stream_chat', 'stream_viewers', 'subscriptions', 'tips',
  'user_blocks', 'user_devices', 'user_interests', 'user_settings', 'verification_requests', 'voice_notes',
  'wallet_transactions', 'wallets', 'media_assets', 'audit_events'
]);

const READ_ONLY_TABLES = new Set(['trending_posts', 'user_profiles']);
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);

function cors(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowedOrigins = new Set([
    env.APP_ORIGIN,
    'https://testagram.site',
    'https://www.testagram.site',
    'capacitor://localhost',
    'http://localhost'
  ]);
  const allowed = origin ? allowedOrigins.has(origin) : false;
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : env.APP_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, range, x-media-type, x-file-name',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function response(request: Request, env: Env, body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors(request, env),
      ...extra
    }
  });
}

function supabaseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  headers.set('apikey', env.SUPABASE_ANON_KEY);
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
  const authorization = request.headers.get('Authorization');
  if (authorization) headers.set('Authorization', authorization);
  const clientInfo = request.headers.get('X-Client-Info');
  if (clientInfo) headers.set('X-Client-Info', clientInfo);
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);
  return headers;
}

function jsonSupabaseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers(supabaseHeaders(request, env));
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  return headers;
}

function requireAuth(request: Request, env: Env): Response | null {
  if (!request.headers.get('Authorization')) {
    return response(request, env, { error: 'Authentication required' }, 401);
  }
  return null;
}

function tableFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/db\/([A-Za-z_][A-Za-z0-9_]*)$/);
  return match?.[1] || null;
}

async function currentUserId(request: Request, env: Env): Promise<string | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const upstream = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: authorization
    }
  });
  if (!upstream.ok) return null;
  const user = await upstream.json() as { id?: string };
  return user.id || null;
}

async function proxyDatabase(request: Request, env: Env, table: string) {
  const writable = !READ_ONLY_TABLES.has(table);
  if (MUTATING_METHODS.has(request.method) && !request.headers.get('Authorization')) {
    return response(request, env, { error: 'Authentication required' }, 401);
  }
  if (request.method !== 'GET' && !writable) {
    return response(request, env, { error: 'Read-only resource' }, 405);
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (MUTATING_METHODS.has(request.method) && contentLength > MAX_JSON_BODY_BYTES) {
    return response(request, env, { error: 'Request body too large' }, 413);
  }

  const url = new URL(request.url);
  const target = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  target.search = url.search;

  const upstream = await fetch(target, {
    method: request.method,
    headers: supabaseHeaders(request, env),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body
  });

  const headers = new Headers(cors(request, env));
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store');
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) headers.set('content-range', contentRange);
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function uploadMedia(request: Request, env: Env): Promise<Response> {
  const authError = requireAuth(request, env);
  if (authError) return authError;

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength <= 0) return response(request, env, { error: 'Media body is required' }, 400);
  if (contentLength > MAX_MEDIA_BYTES) {
    return response(request, env, { error: 'Media exceeds the 20 MiB limit', maxBytes: MAX_MEDIA_BYTES }, 413);
  }

  const mediaType = request.headers.get('X-Media-Type') || 'document';
  if (!MEDIA_TYPES.has(mediaType)) {
    return response(request, env, { error: 'Invalid media type' }, 400);
  }

  const userId = await currentUserId(request, env);
  if (!userId) return response(request, env, { error: 'Invalid or expired session' }, 401);

  const assetId = crypto.randomUUID();
  const rawName = request.headers.get('X-File-Name') || 'upload';
  const safeName = rawName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'upload';
  const key = `${userId}/${assetId}/${safeName}`;
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

  try {
    await env.MEDIA.put(key, request.body, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable'
      },
      customMetadata: {
        ownerId: userId,
        assetId,
        mediaType
      }
    });

    const dbResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/media_assets`, {
      method: 'POST',
      headers: jsonSupabaseHeaders(request, env),
      body: JSON.stringify({
        id: assetId,
        owner_id: userId,
        storage_key: key,
        media_url: `/api/media/${assetId}`,
        media_type: mediaType,
        mime_type: contentType,
        byte_size: contentLength,
        metadata: { storage: 'cloudflare_r2', bucket: 'testagram-media', original_name: rawName }
      })
    });

    if (!dbResponse.ok) {
      const detail = (await dbResponse.text()).slice(0, 500);
      await env.MEDIA.delete(key);
      return response(request, env, { error: 'Media metadata write failed', detail }, 502);
    }

    return response(request, env, {
      id: assetId,
      storage: 'cloudflare-r2',
      storageKey: key,
      url: `/api/media/${assetId}`,
      byteSize: contentLength,
      mediaType,
      mimeType: contentType
    }, 201);
  } catch (error) {
    try { await env.MEDIA.delete(key); } catch { /* best effort cleanup */ }
    return response(request, env, {
      error: error instanceof Error ? error.message : 'Media upload failed'
    }, 502);
  }
}

function mediaIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/media\/([0-9a-f-]{36})$/i);
  return match?.[1] || null;
}

async function canReadPublishedMedia(request: Request, env: Env, id: string): Promise<boolean> {
  const mediaUrl = `/api/media/${id}`;
  const mediaTarget = new URL(`${env.SUPABASE_URL}/rest/v1/post_media`);
  mediaTarget.searchParams.set('select', 'post_id');
  mediaTarget.searchParams.set('media_url', `eq.${mediaUrl}`);
  mediaTarget.searchParams.set('limit', '50');
  const mediaResponse = await fetch(mediaTarget, { headers: supabaseHeaders(request, env) });
  if (!mediaResponse.ok) return false;
  const links = await mediaResponse.json() as Array<{ post_id: string }>;
  if (!links.length) return false;

  const postIds = [...new Set(links.map((row) => row.post_id).filter(Boolean))].slice(0, 50);
  const postsTarget = new URL(`${env.SUPABASE_URL}/rest/v1/posts`);
  postsTarget.searchParams.set('select', 'id');
  postsTarget.searchParams.set('id', `in.(${postIds.join(',')})`);
  postsTarget.searchParams.set('visibility', 'eq.public');
  postsTarget.searchParams.set('deleted_at', 'is.null');
  postsTarget.searchParams.set('limit', '1');
  const postsResponse = await fetch(postsTarget, { headers: supabaseHeaders(request, env) });
  if (!postsResponse.ok) return false;
  const visiblePosts = await postsResponse.json() as Array<{ id: string }>;
  return visiblePosts.length > 0;
}

export async function getMedia(request: Request, env: Env, id: string): Promise<Response> {
  const target = new URL(`${env.SUPABASE_URL}/rest/v1/media_assets`);
  target.searchParams.set('select', 'storage_key,mime_type,owner_id,byte_size');
  target.searchParams.set('id', `eq.${id}`);
  target.searchParams.set('limit', '1');
  const metadataResponse = await fetch(target, { headers: supabaseHeaders(request, env) });
  if (!metadataResponse.ok) return response(request, env, { error: 'Media metadata lookup failed' }, 502);
  const rows = await metadataResponse.json() as Array<{ storage_key: string; mime_type?: string; owner_id: string; byte_size: number }>;
  if (!rows.length) return response(request, env, { error: 'Media not found' }, 404);

  const authorization = request.headers.get('Authorization');
  let isOwner = false;
  if (authorization) {
    const userId = await currentUserId(request, env);
    if (userId) isOwner = rows[0].owner_id === userId;
  }

  if (!isOwner && !(await canReadPublishedMedia(request, env, id))) {
    return response(request, env, { error: 'Media access denied' }, 403);
  }

  const object = await env.MEDIA.get(rows[0].storage_key);
  if (!object) return response(request, env, { error: 'Media object not found' }, 404);

  const headers = new Headers(cors(request, env));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Type', rows[0].mime_type || object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Length', String(rows[0].byte_size));
  return new Response(object.body, { status: 200, headers });
}

export async function deleteMedia(request: Request, env: Env, id: string): Promise<Response> {
  const authError = requireAuth(request, env);
  if (authError) return authError;
  const userId = await currentUserId(request, env);
  if (!userId) return response(request, env, { error: 'Invalid or expired session' }, 401);

  const target = new URL(`${env.SUPABASE_URL}/rest/v1/media_assets`);
  target.searchParams.set('select', 'storage_key,owner_id');
  target.searchParams.set('id', `eq.${id}`);
  target.searchParams.set('owner_id', `eq.${userId}`);
  target.searchParams.set('limit', '1');
  const lookup = await fetch(target, { headers: supabaseHeaders(request, env) });
  if (!lookup.ok) return response(request, env, { error: 'Media metadata lookup failed' }, 502);
  const rows = await lookup.json() as Array<{ storage_key: string; owner_id: string }>;
  if (!rows.length) return response(request, env, { error: 'Media not found' }, 404);

  await env.MEDIA.delete(rows[0].storage_key);
  const deleted = await fetch(`${env.SUPABASE_URL}/rest/v1/media_assets?id=eq.${id}&owner_id=eq.${userId}`, {
    method: 'DELETE',
    headers: supabaseHeaders(request, env)
  });
  if (!deleted.ok) return response(request, env, { error: 'Media metadata delete failed' }, 502);
  return response(request, env, { ok: true, id });
}

async function backendHealth(request: Request, env: Env): Promise<Response> {
  let databaseReachable = false;
  let databaseStatus = 0;
  try {
    const upstream = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: env.SUPABASE_ANON_KEY },
      method: 'GET'
    });
    databaseStatus = upstream.status;
    databaseReachable = upstream.ok;
  } catch {
    databaseReachable = false;
  }

  const r2Reachable = Boolean(env.MEDIA);
  const ok = databaseReachable && r2Reachable;
  return response(request, env, {
    ok,
    service: 'testagram-api',
    database: 'supabase',
    supabaseProjectRef: env.SUPABASE_PROJECT_REF,
    databaseReachable,
    databaseStatus,
    media: 'cloudflare-r2',
    r2Binding: r2Reachable,
    maxMediaBytes: MAX_MEDIA_BYTES,
    edge: 'cloudflare'
  }, ok ? 200 : 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request, env) });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return backendHealth(request, env);
    }

    if (url.pathname === '/api/media' && request.method === 'POST') {
      return uploadMedia(request, env);
    }

    const mediaId = mediaIdFromPath(url.pathname);
    if (mediaId && request.method === 'GET') return getMedia(request, env, mediaId);
    if (mediaId && request.method === 'DELETE') return deleteMedia(request, env, mediaId);

    const table = tableFromPath(url.pathname);
    if (table && (TABLES.has(table) || READ_ONLY_TABLES.has(table))) {
      try {
        return await proxyDatabase(request, env, table);
      } catch (error) {
        return response(request, env, {
          error: error instanceof Error ? error.message : 'Upstream database request failed'
        }, 502);
      }
    }

    return response(request, env, { error: 'Not found' }, 404);
  }
};