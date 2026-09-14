const DEFAULT_UPSTREAM = 'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/gateway-relay';
const MAX_BODY_BYTES = 256 * 1024;
const TIMEOUT_MS = 15_000;

function upstream(): string {
  const value = process.env.SUPABASE_GATEWAY_URL || DEFAULT_UPSTREAM;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid federation upstream');
  return url.toString().replace(/\/$/, '');
}

function requestId(req: Request): string {
  const value = req.headers.get('x-request-id');
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

export async function relay(req: Request, path: string, init?: { method?: string; body?: unknown; params?: Record<string, string | undefined> }) {
  if (!path.startsWith('/') || path.includes('://') || path.includes('..')) {
    return Response.json({ error: 'Invalid gateway path' }, { status: 400 });
  }
  const url = new URL(upstream());
  url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
  for (const [key, value] of Object.entries(init?.params || {})) if (value !== undefined && value !== '') url.searchParams.set(key, value);

  const headers = new Headers({ Accept: 'application/json', 'X-Request-ID': requestId(req) });
  const auth = req.headers.get('authorization');
  if (auth) headers.set('Authorization', auth);
  let body: string | undefined;
  if (init?.body !== undefined) {
    body = JSON.stringify(init.body);
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return Response.json({ error: 'Request body too large' }, { status: 413 });
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: init?.method || 'GET', headers, body, signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': headers.get('X-Request-ID')! } });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? 'Federation gateway timeout' : 'Federation gateway unavailable';
    return Response.json({ error: message, requestId: headers.get('X-Request-ID') }, { status: 502, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': headers.get('X-Request-ID')! } });
  } finally { clearTimeout(timer); }
}
