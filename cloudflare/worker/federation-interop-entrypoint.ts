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
function ap(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/activity+json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } }); }

async function actorRecord(env: any, username: string) {
  const encoded = encodeURIComponent(username);
  const canonical = `${ORIGIN}/users/${encoded}`;
  const canonicalRows = await db(env, `federation_actors?actor_url=eq.${encodeURIComponent(canonical)}&select=*`).catch(() => []);
  if (canonicalRows[0]) return canonicalRows[0];
  const rows = await db(env, `federation_actors?username=eq.${encoded}&select=*`).catch(() => []);
  return rows[0] || null;
}

async function profile(env: any, userId: string) {
  const rows = await db(env, `profiles?id=eq.${encodeURIComponent(userId)}&select=id,username,display_name,avatar_url,bio,website,location,verified_tier,protected_account`).catch(() => []);
  return rows[0] || null;
}

async function moveMetadata(env: any, actorId: string) {
  const [outbound, inbound] = await Promise.all([
    db(env, `federation_actor_moves?old_actor_uri=eq.${encodeURIComponent(actorId)}&select=new_actor_uri`).catch(() => []),
    db(env, `federation_actor_moves?new_actor_uri=eq.${encodeURIComponent(actorId)}&select=old_actor_uri`).catch(() => []),
  ]);
  return {
    ...(outbound[0]?.new_actor_uri ? { movedTo: outbound[0].new_actor_uri } : {}),
    ...(inbound.length ? { alsoKnownAs: [...new Set(inbound.map((x: any) => String(x.old_actor_uri || '')).filter(Boolean))] } : {}),
  };
}

async function webfinger(env: any, request: Request) {
  const resource = new URL(request.url).searchParams.get('resource') || '';
  const value = resource.replace(/^acct:/, '').replace(/^@/, '');
  const [username, domain] = value.split('@');
  if (!username || domain !== DOMAIN) return new Response(JSON.stringify({ error: 'actor not found' }), { status: 404, headers: { 'Content-Type': 'application/jrd+json; charset=utf-8' } });
  const row = await actorRecord(env, username);
  if (!row) return new Response(JSON.stringify({ error: 'actor not found' }), { status: 404, headers: { 'Content-Type': 'application/jrd+json; charset=utf-8' } });
  const name = actorName(row, username), id = `${ORIGIN}/users/${encodeURIComponent(name)}`;
  return new Response(JSON.stringify({ subject: `acct:${name}@${DOMAIN}`, aliases: [id], links: [{ rel: 'self', type: 'application/activity+json', href: id }] }), { status: 200, headers: { 'Content-Type': 'application/jrd+json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function actorGet(env: any, username: string) {
  const row = await actorRecord(env, username);
  if (!row) return ap({ error: 'actor not found' }, 404);
  const p = await profile(env, row.user_id);
  if (!p) return ap({ error: 'profile not found' }, 404);
  const name = actorName(row, p.username || username), id = `${ORIGIN}/users/${encodeURIComponent(name)}`;
  const discoverable = p.protected_account !== true;
  const actor: any = {
    '@context': CTX, id, type: 'Person', preferredUsername: name, name: String(p.display_name || name).trim() || name, url: id,
    inbox: `${id}/inbox`, outbox: `${id}/outbox`, followers: `${id}/followers`, following: `${id}/following`,
    manuallyApprovesFollowers: p.protected_account === true, discoverable, indexable: discoverable,
    publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: row.public_key_pem },
    ...(await moveMetadata(env, id)),
  };
  if (p.bio) actor.summary = p.bio;
  if (p.website) actor.url = p.website;
  if (p.avatar_url) actor.icon = { type: 'Image', mediaType: 'image/jpeg', url: p.avatar_url };
  if (p.location) actor.location = { type: 'Place', name: p.location };
  if (p.verified_tier && p.verified_tier !== 'none') actor.attachment = [{ type: 'PropertyValue', name: 'Verified', value: p.verified_tier }];
  actor.webfinger = `acct:${name}@${DOMAIN}`;
  return ap(actor);
}

async function noteGet(env: any, username: string, noteId: string) {
  const local = await actorRecord(env, username);
  if (!local) return ap({ error: 'actor not found' }, 404);
  const rows = await db(env, `posts?id=eq.${encodeURIComponent(noteId)}&author_id=eq.${encodeURIComponent(local.user_id)}&select=*&limit=1`) as any[];
  const post = rows[0];
  if (!post || String(post.visibility || 'public') !== 'public') return ap({ error: 'object not found' }, 404);
  const id = `${ORIGIN}/users/${encodeURIComponent(actorName(local, username))}/notes/${encodeURIComponent(noteId)}`;
  const published = post.created_at || post.published_at || new Date().toISOString();
  const tags = Array.isArray(post.hashtags) ? post.hashtags : [];
  return ap({ '@context': CTX, id, type: 'Note', attributedTo: local.actor_url || local.uri, url: id, content: String(post.content || ''), published, to: ['https://www.w3.org/ns/activitystreams#Public'], cc: [`${local.actor_url || local.uri}/followers`], sensitive: false, ...(tags.length ? { tag: tags } : {}), attachment: Array.isArray(post.media_urls) ? post.media_urls.map((url: string) => ({ type: 'Document', mediaType: 'application/octet-stream', url })) : [] });
}

async function remoteInteractionObject(env: any, request: Request, username: string, interactionId: string) {
  if (request.method !== 'GET') return null;
  const local = await actorRecord(env, username);
  if (!local) return ap({ error: 'actor not found' }, 404);
  const rows = await db(env, `federation_remote_interactions?id=eq.${encodeURIComponent(interactionId)}&local_user_id=eq.${encodeURIComponent(local.user_id)}&select=id,interaction_type,status,payload,object_url,activity_uri`) as any[];
  const row = rows[0];
  if (!row || !['reply', 'quote'].includes(String(row.interaction_type))) return ap({ error: 'object not found' }, 404);
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : null;
  const object = payload?.object && typeof payload.object === 'object' ? payload.object : null;
  if (!object || typeof object.id !== 'string') return ap({ error: 'object not found' }, 404);
  const expectedId = `${ORIGIN}/users/${encodeURIComponent(actorName(local, username))}/remote-interactions/${interactionId}`;
  if (object.id !== expectedId) return ap({ error: 'object identity mismatch' }, 409);
  return ap({ '@context': Array.isArray(payload['@context']) ? payload['@context'] : CTX, ...object });
}

async function verifyCollectionSyncRequest(req: Request, local: any, expectedDomain: string) {
  const signatureHeader = req.headers.get('Signature'), date = req.headers.get('Date');
  if (!signatureHeader || !date) throw new Error('Collection-Synchronization requires a signed GET');
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 12 * 60 * 60 * 1000) throw new Error('Stale Collection-Synchronization signature');
  const parsed: Record<string, string> = {};
  for (const part of signatureHeader.split(/,(?=\w+=)/)) { const i = part.indexOf('='); if (i > 0) parsed[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/^"|"$/g, ''); }
  if ((parsed.algorithm || '').toLowerCase() !== 'rsa-sha256' || !parsed.keyId || !parsed.signature || !parsed.headers) throw new Error('Unsupported Collection-Synchronization HTTP signature');
  const actorUri = parsed.keyId.split('#')[0];
  if (new URL(actorUri).hostname.toLowerCase() !== expectedDomain.toLowerCase()) throw new Error('Collection-Synchronization signer domain mismatch');
  const remote = await signedGet(local, actorUri);
  if (!remote.ok) throw new Error(`Remote signer ${remote.status}`);
  const actor = await remote.json() as any;
  if (actor.id !== actorUri || actor.publicKey?.owner !== actorUri || !actor.publicKey?.publicKeyPem) throw new Error('Remote signer actor is invalid');
  const key = await crypto.subtle.importKey('spki', pemToBytes(actor.publicKey.publicKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const u = new URL(req.url), lines: string[] = [];
  for (const header of parsed.headers.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (header === '(request-target)') lines.push(`(request-target): get ${u.pathname}${u.search}`);
    else if (header === 'host') lines.push(`host: ${u.host}`);
    else { const value = req.headers.get(header); if (value === null) throw new Error(`signed header missing: ${header}`); lines.push(`${header}: ${value}`); }
  }
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, ub64(parsed.signature), new TextEncoder().encode(lines.join('\n')))) throw new Error('Invalid Collection-Synchronization signature');
  return actorUri;
}

async function followersSynchronization(env: any, request: Request, username: string) {
  const local = await actorRecord(env, username);
  if (!local) return ap({ error: 'actor not found' }, 404);
  const url = new URL(request.url), domain = (url.searchParams.get('domain') || '').toLowerCase().trim();
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) return ap({ error: 'domain is required' }, 400);
  await verifyCollectionSyncRequest(request, local, domain);
  const rows = await db(env, `federated_relationships?local_user_id=eq.${encodeURIComponent(local.user_id)}&relationship=eq.follower&state=in.(accepted,active)&select=remote_actor_uri`) as any[];
  const orderedItems = [...new Set((rows || []).map((r: any) => String(r.remote_actor_uri || '')).filter((uri: string) => { try { return new URL(uri).hostname.toLowerCase() === domain; } catch { return false; } }))].sort();
  const collectionId = `${local.actor_url || local.uri}/followers`;
  return ap({ '@context': CTX, id: `${collectionId}?domain=${encodeURIComponent(domain)}`, type: 'OrderedCollection', totalItems: orderedItems.length, orderedItems });
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
  for (const part of value.split(/,(?=\w+=)/)) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/^"|"$/g, ''); }
  return out;
}

function parseStructuredParams(value: string) {
  const match = value.match(/^sig1=(\([^)]*\))(.*)$/);
  if (!match) throw new Error('Malformed Signature-Input');
  const components = [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const params = match[1] + match[2];
  const created = Number(match[2].match(/;created=(\d+)/)?.[1] || 0);
  const keyId = match[2].match(/;keyid="([^"]+)"/)?.[1] || '';
  const alg = match[2].match(/;alg="([^"]+)"/)?.[1] || '';
  return { components, params, created, keyId, alg };
}

function parseRfcSignature(value: string) {
  const match = value.match(/^sig1=:([^:]+):$/);
  if (!match) throw new Error('Malformed Signature');
  return match[1];
}

async function verifyRfc9421(req: Request, body: string, local: any, actorUri: string) {
  const input = req.headers.get('Signature-Input'), signature = req.headers.get('Signature'), digest = req.headers.get('Content-Digest');
  if (!input || !signature || !digest) throw new Error('Missing RFC9421 signature headers');
  const parsed = parseStructuredParams(input);
  if (parsed.components.length !== 3 || !parsed.components.includes('@method') || !parsed.components.includes('@target-uri') || !parsed.components.includes('content-digest')) throw new Error('RFC9421 signature must cover @method, @target-uri and content-digest');
  if (parsed.alg !== 'rsa-v1_5-sha256') throw new Error('Unsupported RFC9421 algorithm');
  if (!parsed.keyId || parsed.keyId.split('#')[0] !== actorUri) throw new Error('RFC9421 keyId actor mismatch');
  if (!parsed.created || Math.abs(Date.now() / 1000 - parsed.created) > MAX_CLOCK_SKEW) throw new Error('Stale RFC9421 signature');
  const digestMatch = digest.match(/^sha-256=:([^:]+):$/i);
  if (!digestMatch) throw new Error('Unsupported Content-Digest');
  const expectedDigest = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  if (digestMatch[1] !== expectedDigest) throw new Error('Content-Digest mismatch');
  const remote = await signedGet(local, actorUri);
  if (!remote.ok) throw new Error(`Remote actor ${remote.status}`);
  const actor = await remote.json() as any;
  if (actor.id !== actorUri || actor.publicKey?.owner !== actorUri) throw new Error('Remote actor identity mismatch');
  const pem = actor.publicKey?.publicKeyPem;
  if (!pem) throw new Error('Remote actor has no public key');
  const key = await crypto.subtle.importKey('spki', pemToBytes(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const lines = [`"@method": ${req.method}`, `"@target-uri": ${new URL(req.url).toString()}`, `"content-digest": ${digest}`, `"@signature-params": ${parsed.params}`];
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, ub64(parseRfcSignature(signature)), new TextEncoder().encode(lines.join('\n')))) throw new Error('Invalid RFC9421 signature');
  return actorUri;
}

async function verifyLegacy(req: Request, body: string, local: any) {
  const signatureHeader = req.headers.get('Signature'), date = req.headers.get('Date'), digest = req.headers.get('Digest');
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
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, ub64(parsed.signature), new TextEncoder().encode(lines.join('\n')))) throw new Error('Invalid ActivityPub HTTP signature');
  return actorUri;
}

async function verifyRequest(req: Request, body: string, local: any) {
  const input = req.headers.get('Signature-Input');
  if (input) {
    const actorUri = input.match(/;keyid="([^"]+)"/)?.[1]?.split('#')[0] || '';
    if (!actorUri) throw new Error('RFC9421 keyId is required');
    return verifyRfc9421(req, body, local, actorUri);
  }
  return verifyLegacy(req, body, local);
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
    const syncMatch = url.pathname.match(/^\/users\/([^/]+)\/followers_synchronization$/);
    if (request.method === 'GET' && url.pathname === '/.well-known/webfinger') return webfinger(env, request);
    if (request.method === 'GET' && actorMatch) return actorGet(env, decodeURIComponent(actorMatch[1]));
    if (request.method === 'GET' && noteMatch) return noteGet(env, decodeURIComponent(noteMatch[1]), decodeURIComponent(noteMatch[2]));
    if (request.method === 'GET' && interactionObjectMatch) return remoteInteractionObject(env, request, decodeURIComponent(interactionObjectMatch[1]), interactionObjectMatch[2]);
    if (request.method === 'GET' && syncMatch) return followersSynchronization(env, request, decodeURIComponent(syncMatch[1]));
    if (request.method === 'POST' && inboxMatch) return handleFederationInteraction(request, env, decodeURIComponent(inboxMatch[1]));
    return worker.fetch(request, env, ctx);
  },
};