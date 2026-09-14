import type { VercelRequest, VercelResponse } from '@vercel/node';
import { relay } from '../_lib/federation-gateway';

const ROUTES: Record<string, string> = {
  like: '/like', unlike: '/unlike', boost: '/boost', unboost: '/unboost', reply: '/reply', quote: '/quote'
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  const body = req.body;
  if (!body || typeof body !== 'object' || typeof body.action !== 'string') return res.status(400).json({ error: 'action is required' });
  const route = ROUTES[body.action];
  if (!route) return res.status(400).json({ error: 'Unsupported federation action' });
  const upstreamReq = new Request('https://vercel.testagram.internal/api/federation/interaction', { method: 'POST', headers: { authorization: auth, 'x-request-id': req.headers['x-request-id']?.toString() || '' } });
  const response = await relay(upstreamReq, route, { method: 'POST', body });
  res.status(response.status).setHeader('Content-Type', response.headers.get('content-type') || 'application/json').setHeader('Cache-Control', 'no-store');
  res.send(await response.text());
}
