export const config = { runtime: 'edge' };

const MAX_BODY_BYTES = 256 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function authorized(req: Request): boolean {
  const secret = process.env.FEDERATION_BRIDGE_SECRET;
  return !!secret && req.headers.get('x-testagram-federation-secret') === secret;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!authorized(req)) return json(401, { error: 'unauthorized' });
  const upstreamUrl = process.env.SUPABASE_FEDERATION_SYNC_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!upstreamUrl || !serviceKey) return json(503, { error: 'federation_sync_not_configured' });

  const contentLength = Number(req.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) return json(413, { error: 'request_too_large' });

  let raw: string;
  try { raw = await req.text(); } catch { return json(400, { error: 'invalid_body' }); }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { error: 'request_too_large' });

  let body: unknown = {};
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'object_body_required' });

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'content-type': 'application/json',
        'x-testagram-federation-bridge': 'vercel-edge',
        'idempotency-key': req.headers.get('idempotency-key') || crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      redirect: 'error',
    });
    const text = await upstream.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 8192) }; }
    return json(upstream.status, data);
  } catch {
    return json(502, { error: 'federation_sync_unreachable' });
  }
}
