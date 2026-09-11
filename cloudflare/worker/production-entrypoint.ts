import publicActor from './public-actor-entrypoint';
import federation from './federation-entrypoint';
import federationInterop from './federation-interop-entrypoint';
import { handlePayPal, PayPalEnv } from './paypal';
import { uploadMedia, getMedia, deleteMedia } from './index';
import { getPublicMedia } from './public-media';

// Public post media is served through the R2 media handler; browser media requests must not require a bearer token.
interface Env extends PayPalEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  SUPABASE_PROJECT_REF: string;
  SUPABASE_JWKS_URL: string;
  SUPABASE_ANON_KEY: string;
  APP_ORIGIN: string;
  MEDIA: R2Bucket;
}

const GATEWAY_FUNCTION = 'gateway-relay';
const GATEWAY_TIMEOUT_MS = 15000;
const GATEWAY_GET_ATTEMPTS = 3;
const ALLOWED_APP_ORIGINS = new Set(['https://testagram.site', 'https://www.testagram.site']);

function responseOrigin(env: Env, request?: Request): string {
  const origin = request?.headers.get('Origin');
  if (origin && ALLOWED_APP_ORIGINS.has(origin)) return origin;
  if (ALLOWED_APP_ORIGINS.has(env.APP_ORIGIN)) return env.APP_ORIGIN;
  return 'https://www.testagram.site';
}

function cors(env: Env, methods = 'GET,POST,PATCH,PUT,DELETE,OPTIONS', request?: Request) {
  return {
    'Access-Control-Allow-Origin': responseOrigin(env, request),
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, range, x-media-type, x-file-name, x-request-id',
    'Access-Control-Expose-Headers': 'x-request-id, retry-after',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
function requestId(request: Request) { return request.headers.get('x-request-id') || crypto.randomUUID(); }
function json(env: Env, payload: unknown, status = 200, id?: string, request?: Request) {
  const headers = new Headers({ ...cors(env, 'GET,POST,PATCH,PUT,DELETE,OPTIONS', request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (id) headers.set('x-request-id', id);
  return new Response(JSON.stringify(payload), { status, headers });
}

async function health(env: Env, id?: string, request?: Request): Promise<Response> {
  let databaseStatus = 0, databaseReachable = false, databaseError: string | undefined;
  try {
    const upstream = await fetch(`${env.SUPABASE_URL}/rest/v1/`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Accept: 'application/json', 'User-Agent': 'Testagram-Cloudflare-Worker/1.0' } });
    databaseStatus = upstream.status;
    databaseReachable = upstream.ok;
    if (!upstream.ok) databaseError = (await upstream.text()).slice(0, 300);
  } catch (error) { databaseError = error instanceof Error ? error.message : 'Supabase request failed'; }
  let jwksReachable = false;
  try {
    const jwks = await fetch(env.SUPABASE_JWKS_URL, { headers: { Accept: 'application/json', 'User-Agent': 'Testagram-Cloudflare-Worker/1.0' } });
    jwksReachable = jwks.ok;
  } catch (error) { if (!databaseError) databaseError = error instanceof Error ? error.message : 'JWKS request failed'; }
  const r2Binding = Boolean(env.MEDIA), ok = databaseReachable && jwksReachable && r2Binding;
  return json(env, { ok, service: 'testagram-api', gateway: true, federation: true, federationDomain: 'federation.testagram.site', gatewayEndpoint: 'https://api.testagram.site/api/gateway', database: 'supabase', supabaseProjectRef: env.SUPABASE_PROJECT_REF, databaseReachable, databaseStatus, ...(databaseError ? { databaseError } : {}), jwksReachable, media: 'cloudflare-r2', r2Binding, maxMediaBytes: 20 * 1024 * 1024, edge: 'cloudflare' }, ok ? 200 : 503, id, request);
}
async function ready(env: Env, id?: string, request?: Request): Promise<Response> { const h = await health(env, id, request); const body = await h.json() as any; const readyForTraffic = body.ok === true && body.gateway === true; return json(env, { ...body, ready: readyForTraffic }, readyForTraffic ? 200 : 503, id, request); }

async function gateway(request: Request, env: Env): Promise<Response> {
  const id = requestId(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(env, 'GET,POST,OPTIONS', request), 'x-request-id': id } });
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json(env, { ok: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId: id }, 401, id, request);
  const raw = await request.text(); let input: any;
  try { input = raw ? JSON.parse(raw) : {}; } catch { return json(env, { ok: false, error: 'Invalid JSON gateway request', code: 'INVALID_JSON', requestId: id }, 400, id, request); }
  const innerMethod = String(input?.method || 'GET').toUpperCase(), path = String(input?.path || '/');
  if (!path.startsWith('/')) return json(env, { ok: false, error: 'Gateway path must start with /', code: 'INVALID_PATH', requestId: id }, 400, id, request);
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(innerMethod)) return json(env, { ok: false, error: 'Unsupported gateway method', code: 'INVALID_METHOD', requestId: id }, 400, id, request);
  const target = `${env.SUPABASE_URL}/functions/v1/${GATEWAY_FUNCTION}`, headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json', 'x-request-id': id });
  const apikey = request.headers.get('apikey'); headers.set('Authorization', authorization); if (apikey) headers.set('apikey', apikey);
  const upstreamBody = JSON.stringify({ ...input, path, method: innerMethod, requestId: id }), attempts = innerMethod === 'GET' ? GATEWAY_GET_ATTEMPTS : 1; let lastError = 'Gateway upstream unavailable';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
    try {
      const upstream = await fetch(target, { method: 'POST', headers, body: upstreamBody, signal: controller.signal }), responseBody = await upstream.text(), responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('x-request-id', id); responseHeaders.set('Cache-Control', 'no-store'); responseHeaders.set('Access-Control-Allow-Origin', responseOrigin(env, request)); responseHeaders.set('Access-Control-Expose-Headers', 'x-request-id, retry-after'); responseHeaders.set('Vary', 'Origin');
      if (upstream.ok || ![502, 503, 504].includes(upstream.status) || attempt === attempts) return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
      lastError = `Gateway upstream returned ${upstream.status}`;
    } catch (error) { lastError = error instanceof Error && error.name === 'AbortError' ? 'Gateway upstream timeout' : error instanceof Error ? error.message : lastError; if (attempt === attempts) break; } finally { clearTimeout(timer); }
    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
  }
  return json(env, { ok: false, error: lastError, code: 'GATEWAY_UPSTREAM_UNAVAILABLE', requestId: id, retryable: innerMethod === 'GET' }, 503, id, request);
}

export default { async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url), id = requestId(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(env, 'GET,POST,PATCH,PUT,DELETE,OPTIONS', request), 'x-request-id': id } });
  if (url.hostname === 'federation.testagram.site') return federationInterop.fetch(request, env, ctx);
  if (url.pathname === '/api/health') return health(env, id, request);
  if (url.pathname === '/api/ready') return ready(env, id, request);
  if (url.pathname === '/api/media' && request.method === 'POST') return uploadMedia(request, env as any);
  const mediaMatch = url.pathname.match(/^\/api\/media\/([0-9a-f-]{36})$/i);
  if (mediaMatch && request.method === 'GET') return getPublicMedia(request, env as any, mediaMatch[1]);
  if (mediaMatch && request.method === 'DELETE') return deleteMedia(request, env as any, mediaMatch[1]);
  if (url.pathname === '/api/gateway' || url.pathname === '/api/gateway/') return gateway(request, env);
  if (url.pathname.startsWith('/api/paypal/')) return handlePayPal(request, env);
  return publicActor.fetch(request, env, ctx);
} };
