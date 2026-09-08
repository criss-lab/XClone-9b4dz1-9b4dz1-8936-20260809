import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function authUser(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, '');
  const client = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error || !user ? null : user;
}

function route(req: Request) {
  const url = new URL(req.url);
  return url.pathname.replace(/^\/functions\/v1\/platform-vps/, '').replace(/^\/platform-vps/, '') || '/';
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const path = route(req);
  if (req.method === 'GET' && path === '/health') {
    const started = Date.now();
    const { error } = await admin.from('profiles').select('id', { head: true, count: 'exact' });
    return json({ ok: !error, service: 'platform-vps', runtime: 'supabase-edge', databaseReachable: !error, latencyMs: Date.now() - started, timestamp: new Date().toISOString() }, error ? 503 : 200);
  }

  const user = await authUser(req);
  if (!user) return json({ error: 'Authentication required' }, 401);

  if (req.method === 'GET' && path === '/me') {
    const [{ data: profile, error: pe }, { data: wallet, error: we }, { data: transactions, error: te }] = await Promise.all([
      admin.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      admin.from('wallets').select('id,balance,currency,total_deposited,total_withdrawn,created_at,updated_at').eq('user_id', user.id).maybeSingle(),
      admin.from('wallet_transactions').select('id,type,status,amount,currency,balance_before,balance_after,provider,provider_reference,description,created_at,completed_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    ]);
    if (pe || we || te) return json({ error: 'Backend read failed' }, 500);
    return json({ ok: true, user: { id: user.id, email: user.email }, profile, wallet, transactions: transactions ?? [] });
  }

  if (req.method === 'POST' && path === '/wallet/ensure') {
    const body = await req.json().catch(() => ({}));
    const currency = String(body.currency || 'USD').toUpperCase();
    if (!['USD', 'KES', 'EUR'].includes(currency)) return json({ error: 'Unsupported currency' }, 400);
    const { data, error } = await admin.rpc('ensure_user_wallet', { p_user_id: user.id, p_currency: currency });
    if (error) return json({ error: 'Wallet provisioning failed' }, 500);
    return json({ ok: true, wallet: data });
  }

  if (req.method === 'GET' && path === '/wallet/ledger') {
    const { data, error } = await admin.from('wallet_transactions').select('id,type,status,amount,currency,balance_before,balance_after,provider,provider_reference,description,metadata,created_at,completed_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
    if (error) return json({ error: 'Ledger read failed' }, 500);
    return json({ ok: true, transactions: data ?? [] });
  }

  if (req.method === 'PATCH' && path === '/profile') {
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    for (const key of ['display_name', 'bio', 'avatar_url', 'website', 'location']) {
      if (typeof body[key] === 'string') patch[key] = body[key].trim().slice(0, key === 'bio' ? 500 : 300);
    }
    if (!Object.keys(patch).length) return json({ error: 'No editable profile fields supplied' }, 400);
    patch.updated_at = new Date().toISOString();
    const { data, error } = await admin.from('profiles').update(patch).eq('id', user.id).select('*').single();
    if (error) return json({ error: 'Profile update failed' }, 400);
    return json({ ok: true, profile: data });
  }

  return json({ error: 'Not found', service: 'platform-vps' }, 404);
});
