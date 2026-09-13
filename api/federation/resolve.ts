export const config = { runtime: 'edge' };

import { relay } from '../_lib/federation-gateway';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const secret = process.env.FEDERATION_BRIDGE_SECRET;
  if (!secret || req.headers.get('x-testagram-federation-secret') !== secret) return json(401, { error: 'unauthorized' });

  let value = '';
  if (req.method === 'GET') {
    value = new URL(req.url).searchParams.get('acct')?.trim() || new URL(req.url).searchParams.get('actorUrl')?.trim() || '';
  } else {
    let body: unknown;
    try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const b = body as Record<string, unknown>;
      value = typeof b.acct === 'string' ? b.acct.trim() : typeof b.actorUrl === 'string' ? b.actorUrl.trim() : '';
    }
  }
  if (!value || value.length > 512) return json(400, { error: 'acct_or_actor_url_required' });

  const upstreamReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
  });
  return relay(upstreamReq, `/webfinger/${encodeURIComponent(value)}`);
}
