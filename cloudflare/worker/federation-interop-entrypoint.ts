import worker from './index';

const DOMAIN = 'federation.testagram.site';
const ORIGIN = `https://${DOMAIN}`;
const AP = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/activity+json';
const CTX = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];
const MAX_BODY = 2_000_000;
const MAX_CLOCK_SKEW = 5 * 60;

async function db(env: any, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_SECRET_KEY);
  headers.set('Authorization', `Bearer ${env.SUPABASE_SECRET_KEY}`);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`db ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

function actorName(row: any, fallback: string) { return String(row.username || row.preferred_username || fallback || '').trim(); }
function b64(x: ArrayBuffer | Uint8Array) { return btoa(String.fromCharCode(...new Uint8Array(x))); }
function ub64(x: string) { return Uint8Array.from(atob(x), c => c.charCodeAt(0)); }
function pemToBytes(pem: string) { return ub64(pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')); }

async function actorRecord(env: any, username: string) {
  const encoded = encodeURIComponent(username);
  const canonical = `${ORIGIN}/users/${encoded}`;
  const byUrl = await db(env, `federation_actors?actor_url=eq.${encodeURIComponent(canonical)}&select=*`).catch(() => []);
  if (byUrl[0]) return byUrl[0];
  const byName = await db(env, `federation_actors?username=eq.${encoded}&select=*`).catch(() => []);
  return byName[0] || null;
}

async function signedGet(local: any, url: string) {
  const u = new URL(url), date = new Date().toUTCString();
  const key = await crypto.subtle.importKey('jwk', local.private_key_jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const base = `(request-target): get ${u.pathname}${u.search}\nhost: ${u.host}\ndate: ${date}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(base));
  return fetch(url, { headers: { Date: date, Accept: AP, Signature: `keyId="${local.actor_url || local.uri}#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="${b64(signature)}"`, 'User-Agent': 'Testagram-Federation/7.0' } });
}

function parseLegacySignature(value: string) {
  const out: Record<string, string> = {};
  for (const part of value.split(/,(?=\w+=)/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

function parseStructuredParams(value: string) {
  const match = value.match(/^sig1=(\([^)]*\))(.*)$/);
  if (!match) throw new Error('Malformed Signature-Input');
  const components = [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const params = match[2];
  const created = Number(params.match(/;created=(\d+)/)?.[1] || 0);
  const keyId = params.match(/;keyid="([^"]+)"/)?.[1] || '';
  const alg = params.match(/;alg="([^"]+)"/)?.[1] || '';
  return { components, params: match[1] + params, created, keyId, alg };
}

function parseRfcSignature(value: string) {
  const match = value.match(/^sig1=:([^:]+):$/);
  if (!match) throw new Error('Malformed Signature');
  return match[1];
}

async function verifyRfc9421(req: Request, body: string, local: any) {
  const input = req.headers.get('Signature-Input');
  const signature = req.headers.get('Signature');
  const digest = req.headers.get('Content-Digest');
  if (!input || !signature || !digest) throw new Error('Missing RFC9421 signature headers');
  const parsed = parseStructuredParams(input);
  if (parsed.components.length !== 3 || !parsed.components.includes('@method') || !parsed.components.includes('@target-uri') || !parsed.components.includes('content-digest')) throw new Error('RFC9421 signature must cover @method, @target-uri and content-digest');
  if (parsed.alg !== 'rsa-v1_5-sha256') throw new Error('Unsupported RFC9421 algorithm');
  if (!parsed.keyId || parsed.keyId.split('#')[0] !== local.remoteActorUri) throw new Error('RFC9421 keyId actor mismatch');
  if (!parsed.created || Math.abs(Date.now() / 1000 - parsed.created) > MAX_CLOCK_SKEW) throw new Error('Stale RFC9421 signature');
  const digestMatch = digest.match(/^sha-256=:([^:]+):$/i);
  if (!digestMatch) throw new Error('Unsupported Content-Digest');
  const expectedDigest = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  if (digestMatch[1] !== expectedDigest) throw new Error('Content-Digest mismatch');
  const signatureValue = ub64(parseRfcSignature(signature));
  const remote = await signedGet(local, parsed.keyId.split('#')[0]);
  if (!remote.ok) throw new Error(`Remote actor ${remote.status}`);
  const actor = await remote.json() as any;
  const pem = actor.publicKey?.publicKeyPem;
  if (!pem) throw new Error('Remote actor has no public key');
  const key = await crypto.subtle.importKey('spki', pemToBytes(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const target = new URL(req.url).toString();
  const lines = [`"@method": ${req.method}`, `"@target-uri": ${target}`, `"content-digest": ${digest}`, `"@signature-params": ${parsed.params}`];
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signatureValue, new TextEncoder().encode(lines.join('\n')));
  if (!valid) throw new Error('Invalid RFC9421 signature');
  return parsed.keyId.split('#')[0];
}

async function verifyLegacy(req: Request, body: string, local: any) {
  const signatureHeader = req.headers.get('Signature');
  const date = req.headers.get('Date');
  const digest = req.headers.get('Digest');
  if (!signatureHeader || !date || !digest) throw new Error('Missing ActivityPub signature headers');
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 12 * 60 * 60 * 1000) throw new Error('Stale ActivityPub signature');
  const expectedDigest = `sha-256=${b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))}`;
  if (digest.toLowerCase() !== expectedDigest.toLowerCase()) throw new Error('Digest mismatch');
  const parsed = parseLegacySignature(signatureHeader);
  if ((parsed.algorithm || '').toLowerCase() !== 'rsa-sha256' || !parsed.keyId || !parsed.signature || !parsed.headers) throw new Error('Unsupported ActivityPub HTTP signature');
  const actorUri = parsed.keyId.split('#')[0];
  const remote = await signedGet(local, actorUri);
  if (!remote.ok) throw new Error(`Remote actor ${remote.status}`);
  const actor = await remote.json() as any;
  if (actor.id !== actorUri || actor.publicKey?.owner !== actorUri) throw new Error('Remote actor identity mismatch');
  const pem = actor.publicKey?.publicKeyPem;
  if (!pem) throw new Error('Remote actor has no public key');
  const key = await crypto.subtle.importKey('spki', pemToBytes(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const u = new URL(req.url), lines: string[] = [];
  for (const header of parsed.headers.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (header === '(request-target)') lines.push(`(request-target): ${req.method.toLowerCase()} ${u.pathname}${u.search}`);
    else if (header === 'host') lines.push(`host: ${u.host}`);
    else { const value = req.headers.get(header); if (value === null) throw new Error(`signed header missing: ${header}`); lines.push(`${header}: ${value}`); }
  }
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, ub64(parsed.signature), new TextEncoder().encode(lines.join('\n')));
  if (!valid) throw new Error('Invalid ActivityPub HTTP signature');
  return actorUri;
}

async function verifyRequest(req: Request, body: string, local: any) {
  const signatureInput = req.headers.get('Signature-Input');
  if (signatureInput) {
    const keyId = signatureInput.match(/;keyid="([^"]+)"/)?.[1] || '';
    const actorUri = keyId.split('#')[0];
    if (!actorUri) throw new Error('RFC9421 keyId is required');
    return verifyRfc9421(req, body, { ...local, remoteActorUri: actorUri });
  }
  return verifyLegacy(req, body, local);
}

function ap(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/activity+json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

export async function handleFederationInteraction(req: Request, env: any, username: string) {
  if (req.method !== 'POST') return null;
  const local = await actorRecord(env, username);
  if (!local) return ap({ error: 'actor not found' }, 404);
  try {
    const body = await req.text();
    if (!body || body.length > MAX_BODY) return ap({ error: 'Activity body too large' }, 413);
    const activity = JSON.parse(body) as any;
    const declared = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id;
    const verified = await verifyRequest(req, body, local);
    if (declared && declared !== verified) throw new Error('Activity actor does not match signing actor');
    const upstream = `${env.SUPABASE_URL}/functions/v1/federation-inbox`;
    const headers = new Headers({ Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': req.headers.get('content-type') || 'application/activity+json', Accept: req.headers.get('accept') || AP, 'X-Testagram-Edge-Verified': 'true', 'X-Testagram-Verified-Actor': verified });
    const response = await fetch(upstream, { method: 'POST', body, headers });
    const responseText = await response.text();
    return new Response(responseText, { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/activity+json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  } catch (error) {
    console.error('[federation-edge]', error);
    return ap({ error: error instanceof Error ? error.message : 'Federation ingress rejected' }, 401);
  }
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const actorMatch = url.pathname.match(/^\/users\/([^/]+)$/);
    const inboxMatch = url.pathname.match(/^\/users\/([^/]+)\/inbox$/);
    const noteMatch = url.pathname.match(/^\/users\/([^/]+)\/notes\/([^/]+)$/);
    const interactionObjectMatch = url.pathname.match(/^\/users\/([^/]+)\/remote-interactions\/([0-9a-f-]+)$/i);
    if (request.method === 'GET' && url.pathname === '/.well-known/webfinger') return new Response(JSON.stringify({ error: 'Use canonical federation WebFinger handler' }), { status: 404, headers: { 'Content-Type': 'application/jrd+json; charset=utf-8' } });
    if (request.method === 'GET' && actorMatch) return new Response(JSON.stringify({ error: 'Use canonical federation actor handler' }), { status: 404, headers: { 'Content-Type': 'application/activity+json; charset=utf-8' } });
    if (request.method === 'GET' && noteMatch) return new Response(JSON.stringify({ error: 'Use canonical federation object handler' }), { status: 404, headers: { 'Content-Type': 'application/activity+json; charset=utf-8' } });
    if (request.method === 'GET' && interactionObjectMatch) return new Response(JSON.stringify({ error: 'Use canonical federation object handler' }), { status: 404, headers: { 'Content-Type': 'application/activity+json; charset=utf-8' } });
    if (request.method === 'POST' && inboxMatch) return handleFederationInteraction(request, env, decodeURIComponent(inboxMatch[1]));
    return worker.fetch(request, env, ctx);
  },
};