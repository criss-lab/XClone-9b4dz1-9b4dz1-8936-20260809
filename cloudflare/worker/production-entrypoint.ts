import publicActor from './public-actor-entrypoint';
import { handlePayPal, PayPalEnv } from './paypal';

interface Env extends PayPalEnv {
  SUPABASE_PROJECT_REF: string;
  SUPABASE_JWKS_URL: string;
  APP_ORIGIN: string;
  MEDIA: R2Bucket;
}

async function health(env: Env): Promise<Response> {
  let databaseStatus = 0, databaseReachable = false, databaseError: string | undefined;
  try {
    const upstream = await fetch(`${env.SUPABASE_URL}/rest/v1/`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Accept: 'application/json', 'User-Agent': 'Testagram-Cloudflare-Worker/1.0' } });
    databaseStatus = upstream.status; databaseReachable = upstream.ok;
    if (!upstream.ok) databaseError = (await upstream.text()).slice(0, 300);
  } catch (error) { databaseError = error instanceof Error ? error.message : 'Supabase request failed'; }
  let jwksReachable = false;
  try { const jwks = await fetch(env.SUPABASE_JWKS_URL, { headers: { Accept: 'application/json', 'User-Agent': 'Testagram-Cloudflare-Worker/1.0' } }); jwksReachable = jwks.ok; }
  catch (error) { if (!databaseError) databaseError = error instanceof Error ? error.message : 'JWKS request failed'; }
  const r2Binding = Boolean(env.MEDIA), ok = databaseReachable && jwksReachable && r2Binding;
  return new Response(JSON.stringify({ ok, service: 'testagram-api', federation: true, federationDomain: 'federation.testagram.site', database: 'supabase', supabaseProjectRef: env.SUPABASE_PROJECT_REF, databaseReachable, databaseStatus, ...(databaseError ? { databaseError } : {}), jwksReachable, media: 'cloudflare-r2', r2Binding, maxMediaBytes: 20 * 1024 * 1024, edge: 'cloudflare' }), { status: ok ? 200 : 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': env.APP_ORIGIN, 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', Vary: 'Origin' } });
}

export default { async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': env.APP_ORIGIN, 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } });
    return health(env);
  }
  if (url.pathname.startsWith('/api/paypal/')) return handlePayPal(request, env);
  return publicActor.fetch(request, env, ctx);
} };
