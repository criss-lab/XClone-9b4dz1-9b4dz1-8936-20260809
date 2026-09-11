import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '';
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const queue = 'federation_delivery';
const maxBatch = 20;
const visibility = 60;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-federation-internal', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });

function authorized(req: Request) {
  const token = req.headers.get('x-federation-internal');
  const auth = req.headers.get('authorization');
  return Boolean(service && (token === service || auth === `Bearer ${service}`));
}

async function read() {
  const { data, error } = await db.schema('pgmq_public').rpc('read', { queue_name: queue, sleep_seconds: visibility, n: maxBatch });
  if (error) throw error;
  return (data || []) as Array<{ msg_id: number; message: any; read_ct: number; vt: string }>;
}

async function deliver(message: any) {
  const payload = message?.message || {};
  if (!payload.inbox_url || !payload.payload || !payload.user_id) throw new Error('Invalid federation queue message');
  const response = await fetch(`${url}/functions/v1/federation-transport`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${service}`, 'x-federation-internal': service },
    body: JSON.stringify({ operation: 'deliver_inbox', user_id: payload.user_id, target: payload.inbox_url, activity: payload.payload }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`transport ${response.status}: ${text.slice(0, 1000)}`);
  try { return JSON.parse(text); } catch { return { ok: true, raw: text.slice(0, 1000) }; }
}

async function complete(id: number) {
  const { error } = await db.schema('pgmq_public').rpc('delete', { queue_name: queue, msg_id: id });
  if (error) throw error;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  if (!authorized(req)) return json({ ok: false, error: 'Internal federation worker only' }, 403);
  const started = Date.now();
  let messages: Array<{ msg_id: number; message: any; read_ct: number; vt: string }> = [];
  try { messages = await read(); } catch (error) { return json({ ok: false, error: String(error) }, 500); }
  const results: any[] = [];
  for (const message of messages) {
    try {
      const delivery = await deliver(message);
      await complete(message.msg_id);
      results.push({ msg_id: message.msg_id, ok: true, attempts: message.read_ct, delivery });
    } catch (error) {
      results.push({ msg_id: message.msg_id, ok: false, attempts: message.read_ct, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return json({ ok: true, worker: 'federation-delivery-worker', processed: results.length, succeeded: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length, duration_ms: Date.now() - started, results, version: '3.0' });
});
