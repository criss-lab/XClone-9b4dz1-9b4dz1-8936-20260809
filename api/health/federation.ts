import type { VercelRequest, VercelResponse } from '@vercel/node';
import { relay } from '../_lib/federation-gateway';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  const upstreamReq = new Request('https://vercel.testagram.internal/api/health/federation', { headers: { 'x-request-id': req.headers['x-request-id']?.toString() || '' } });
  const started = Date.now();
  const response = await relay(upstreamReq, '/health');
  let upstreamBody: unknown = null;
  try { upstreamBody = await response.clone().json(); } catch { /* preserve health envelope */ }
  const status = response.ok ? 200 : 503;
  return res.status(status).json({ ok: response.ok, service: 'testagram-vercel-federation', upstream: upstreamBody, latency_ms: Date.now() - started });
}
