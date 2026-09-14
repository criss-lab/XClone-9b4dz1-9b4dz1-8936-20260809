import type { VercelRequest, VercelResponse } from '@vercel/node';
import { relay } from '../_lib/federation-gateway';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  const upstreamReq = new Request('https://vercel.testagram.internal/api/feed/unified', { headers: { authorization: auth, 'x-request-id': req.headers['x-request-id']?.toString() || '' } });
  const params: Record<string, string | undefined> = {};
  for (const key of ['cursor', 'limit', 'following']) params[key] = typeof req.query[key] === 'string' ? req.query[key] as string : undefined;
  const response = await relay(upstreamReq, '/timeline/home', { params });
  res.status(response.status).setHeader('Content-Type', response.headers.get('content-type') || 'application/json').setHeader('Cache-Control', 'private, no-store');
  res.send(await response.text());
}
