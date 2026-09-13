export const config = { runtime: 'edge' };

const ALLOWED = new Set([
  'create', 'follow', 'unfollow', 'like', 'unlike', 'boost', 'unboost',
  'reply', 'quote', 'block', 'unblock', 'delete', 'update', 'move',
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const secret = process.env.FEDERATION_BRIDGE_SECRET;
  if (!secret) return json(503, { error: 'federation_bridge_not_configured' });
  if (req.headers.get('x-testagram-federation-secret') !== secret) {
    return json(401, { error: 'unauthorized' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const action = body.action;
  if (typeof action !== 'string' || !ALLOWED.has(action)) {
    return json(400, { error: 'invalid_action' });
  }

  const outbox = process.env.SUPABASE_FEDERATION_OUTBOX_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!outbox || !serviceKey) return json(503, { error: 'federation_outbox_not_configured' });

  const payload = {
    ...body,
    action,
    idempotencyKey: req.headers.get('idempotency-key'),
  };

  try {
    const upstream = await fetch(outbox, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'content-type': 'application/json',
        'x-testagram-federation-bridge': 'vercel-edge',
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return json(upstream.status, data);
  } catch {
    return json(502, { error: 'federation_outbox_unreachable' });
  }
}
