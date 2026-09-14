interface Env { VERCEL_ORIGIN: string; }
function routeFor(pathname: string, search: string): string | null {
  if (pathname === '/.well-known/webfinger') return `/api/federation?route=webfinger${search}`;
  if (pathname === '/.well-known/nodeinfo') return '/api/federation?route=nodeinfo';
  if (pathname === '/nodeinfo/2.0') return '/api/federation?route=nodeinfo20';
  const match = pathname.match(/^\/users\/([^/]+)(?:\/(inbox|outbox|followers|following))?$/); if (!match) return null;
  const username = encodeURIComponent(match[1]); const suffix = match[2] || 'actor'; return `/api/federation?route=${suffix}&username=${username}`;
}
export default { async fetch(request: Request, env: Env): Promise<Response> {
  const incoming = new URL(request.url); const destinationPath = routeFor(incoming.pathname, incoming.search); if (!destinationPath) return fetch(request);
  if (!env.VERCEL_ORIGIN || env.VERCEL_ORIGIN.includes('YOUR-TESTAGRAM')) return new Response('Federation gateway is not configured', { status: 503 });
  const upstream = new URL(destinationPath, env.VERCEL_ORIGIN.replace(/\/$/, '') + '/'); const headers = new Headers(request.headers);
  headers.set('x-original-uri', incoming.pathname + incoming.search); headers.set('x-original-host', incoming.host); headers.set('x-forwarded-host', incoming.host);
  const proxied = new Request(upstream, { method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body, redirect: 'manual' });
  const response = await fetch(proxied); const out = new Response(response.body, response); out.headers.set('Vary', 'Accept'); out.headers.set('X-Testagram-Federation', 'native'); return out;
} };
