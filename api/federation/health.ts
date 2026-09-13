export const config = { runtime: 'edge' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default function handler(req: Request): Response {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  const secret = process.env.FEDERATION_BRIDGE_SECRET;
  if (!secret || req.headers.get('x-testagram-federation-secret') !== secret) return json(401, { error: 'unauthorized' });

  const checks = {
    bridgeSecret: Boolean(secret),
    outbox: Boolean(process.env.SUPABASE_FEDERATION_OUTBOX_URL),
    resolver: Boolean(process.env.SUPABASE_FEDERATION_RESOLVE_URL),
    sync: Boolean(process.env.SUPABASE_FEDERATION_SYNC_URL),
    webhook: Boolean(process.env.SUPABASE_FEDERATION_WEBHOOK_URL),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
  const ready = Object.values(checks).every(Boolean);
  return json(ready ? 200 : 503, { ok: ready, service: 'testagram-vercel-federation-bridge', runtime: 'edge', checks });
}
