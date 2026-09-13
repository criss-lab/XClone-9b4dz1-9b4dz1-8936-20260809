import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED = new Set([
  'create', 'follow', 'unfollow', 'like', 'unlike', 'boost', 'unboost',
  'reply', 'quote', 'block', 'unblock', 'delete', 'update', 'move',
]);

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const secret = process.env.FEDERATION_BRIDGE_SECRET;
  if (!secret) return json(res, 503, { error: 'federation_bridge_not_configured' });
  if (req.headers['x-testagram-federation-secret'] !== secret) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const action = body?.action;
  if (typeof action !== 'string' || !ALLOWED.has(action)) {
    return json(res, 400, { error: 'invalid_action' });
  }

  const outbox = process.env.SUPABASE_FEDERATION_OUTBOX_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!outbox || !serviceKey) {
    return json(res, 503, { error: 'federation_outbox_not_configured' });
  }

  const idempotencyKey = req.headers['idempotency-key'];
  const payload = { ...body, action, idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null };

  const upstream = await fetch(outbox, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'content-type': 'application/json',
      'x-testagram-federation-bridge': 'vercel',
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return json(res, upstream.status, data);
}
