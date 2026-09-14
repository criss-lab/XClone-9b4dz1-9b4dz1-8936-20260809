import type { VercelRequest, VercelResponse } from '@vercel/node';
import { relay } from '../_lib/federation-gateway';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const body = req.body;
  if (!body || typeof body !== 'object' || typeof body.acct !== 'string') return res.status(400).json({ error: 'acct is required' });
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  const upstreamReq = new Request('https://vercel.testagram.internal/api/federation/follow', { method: 'POST', headers: { authorization: auth, 'x-request-id': req.headers['x-request-id']?.toString() || '' } });
  const response = await relay(upstreamReq, body.action === 'unfollow' ? '/unfollow' : '/follow', { method: 'POST', body });
  res.status(response.status).setHeader('Content-Type', response.headers.get('content-type') || 'application/json').setHeader('Cache-Control', 'no-store');
  res.send(await response.text());
}
