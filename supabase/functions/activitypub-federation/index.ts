const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

function normalizeAction(action: string) {
  switch (action) {
    case 'like': case 'favorite': return { interaction: 'like', enabled: true };
    case 'unlike': case 'unfavorite': return { interaction: 'like', enabled: false };
    case 'boost': case 'repost': return { interaction: 'repost', enabled: true };
    case 'unboost': case 'unrepost': return { interaction: 'repost', enabled: false };
    case 'reply': return { interaction: 'reply', enabled: true };
    case 'quote': return { interaction: 'quote', enabled: true };
    case 'follow': return { interaction: 'follow', enabled: true };
    case 'unfollow': case 'undo-follow': return { interaction: 'follow', enabled: false };
    case 'accept-follow': return { interaction: 'follow', enabled: true, lifecycle: 'accepted' };
    case 'reject-follow': return { interaction: 'follow', enabled: false, lifecycle: 'rejected' };
    default: return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required' }, 401);
  try {
    const input = await req.json();
    const mapped = normalizeAction(String(input?.action ?? ''));
    const objectUrl = String(input?.object_url ?? input?.objectUrl ?? '').trim();
    if (!mapped) return json({ error: 'Unsupported interaction' }, 400);
    if (mapped.interaction === 'follow') return json({ error: 'Follow lifecycle must use federation transport, not interaction normalization' }, 409);
    if (!/^https?:\/\//i.test(objectUrl)) return json({ error: 'A remote ActivityPub object URL is required' }, 400);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) return json({ error: 'Supabase URL is not configured' }, 500);
    const upstream = await fetch(`${supabaseUrl}/functions/v1/federation-interact`, { method: 'POST', headers: { Authorization: authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '', 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ interaction: mapped.interaction, objectUrl, enabled: mapped.enabled, ...(input?.content !== undefined ? { content: String(input.content) } : {}) }) });
    const text = await upstream.text(); let body: unknown = null; try { body = text ? JSON.parse(text) : null; } catch { body = { error: text || upstream.statusText }; }
    return json(body, upstream.status);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Federation interaction failed' }, 500); }
});