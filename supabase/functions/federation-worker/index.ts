import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

const AS = 'https://www.w3.org/ns/activitystreams';
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(supabaseUrl, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

function pemToBytes(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return bytes.buffer;
}

async function signRequest(privateKeyPem: string, url: URL, body: string, activityId: string) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const date = new Date().toUTCString();
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const digest = btoa(String.fromCharCode(...new Uint8Array(digestBytes)));
  const signing = `(request-target): post ${url.pathname}\nhost: ${url.host}\ndate: ${date}\ndigest: SHA-256=${digest}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signing));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return {
    Date: date,
    Digest: `SHA-256=${digest}`,
    Signature: `keyId="${activityId}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signatureB64}"`,
  };
}

async function deliver(row: any): Promise<void> {
  const { data: actor } = await db.from('federation_actors').select('actor_uri').eq('id', row.actor_id).single();
  const { data: key } = await db.from('federation_actor_keys').select('private_key_pem').eq('actor_id', row.actor_id).single();
  if (!actor || !key) throw new Error('federation signing key unavailable');

  const body = JSON.stringify(row.payload);
  const url = new URL(row.target_inbox);
  const headers = await signRequest(key.private_key_pem, url, body, actor.actor_uri);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      Host: url.host,
      Accept: 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      'Content-Type': 'application/activity+json',
      'User-Agent': 'Testagram/1.0 (+https://www.testagram.site/)',
    },
    body,
    redirect: 'manual',
  });

  if (response.status >= 200 && response.status < 300) {
    await db.from('federation_deliveries').update({ state: 'delivered', delivered_at: new Date().toISOString(), last_status: response.status, last_error: null }).eq('id', row.id);
    return;
  }
  const text = (await response.text()).slice(0, 1000);
  const attempts = Number(row.attempts || 0) + 1;
  const dead = attempts >= 8;
  const delaySeconds = Math.min(3600, 15 * Math.pow(2, attempts - 1));
  await db.from('federation_deliveries').update({
    state: dead ? 'dead' : 'retry',
    attempts,
    next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    last_status: response.status,
    last_error: text || `HTTP ${response.status}`,
  }).eq('id', row.id);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${serviceRole}`) return new Response('Unauthorized', { status: 401 });

  const { data: rows, error } = await db.from('federation_deliveries')
    .select('*')
    .in('state', ['queued', 'retry'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(25);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let delivered = 0;
  let failed = 0;
  for (const row of rows || []) {
    await db.from('federation_deliveries').update({ state: 'delivering', attempts: Number(row.attempts || 0) + 1 }).eq('id', row.id);
    try { await deliver(row); delivered++; } catch (e) {
      failed++;
      await db.from('federation_deliveries').update({ state: 'retry', last_error: String(e), next_attempt_at: new Date(Date.now() + 60000).toISOString() }).eq('id', row.id);
    }
  }
  return Response.json({ ok: true, processed: rows?.length || 0, delivered, failed });
});
