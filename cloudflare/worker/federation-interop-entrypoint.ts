import federation from './federation-entrypoint';
import { handleFederationInteraction } from './federation-interaction-entrypoint';

const DOMAIN = 'federation.testagram.site';
const ORIGIN = `https://${DOMAIN}`;
const AP = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/activity+json';
const CTX = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];

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
function publicKeyPem(spki: ArrayBuffer) { const raw = btoa(String.fromCharCode(...new Uint8Array(spki))); return `-----BEGIN PUBLIC KEY-----\n${raw.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`; }

async function ensureActor(env: any, username: string) {
  const encoded = encodeURIComponent(username);
  const profiles = await db(env, `profiles?username=eq.${encoded}&select=id,username,display_name,avatar_url,bio,website,location,verified_tier,protected_account`) as any[];
  const profile = profiles[0];
  if (!profile) return null;

  const existing = await db(env, `federation_actors?user_id=eq.${encodeURIComponent(profile.id)}&select=*`) as any[];
  if (existing[0]) return existing[0];

  const name = String(profile.username || username).trim();
  const id = `${ORIGIN}/users/${encodeURIComponent(name)}`;
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const pem = publicKeyPem(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  try {
    const created = await db(env, 'federation_actors', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: profile.id,
        username: name,
        actor_url: id,
        inbox_url: `${id}/inbox`,
        public_key_pem: pem,
        private_key_jwk: privateKeyJwk,
      }),
    }) as any[];
    return created[0] || null;
  } catch (error) {
    if (!String(error).includes('db 409')) throw error;
    const raced = await db(env, `federation_actors?user_id=eq.${encodeURIComponent(profile.id)}&select=*`) as any[];
    return raced[0] || null;
  }
}

async function actorRecord(env: any, username: string) {
  const encoded = encodeURIComponent(username);
  const canonicalActorUrl = `${ORIGIN}/users/${encoded}`;
  const canonical = await db(env, `federation_actors?actor_url=eq.${encodeURIComponent(canonicalActorUrl)}&select=*`) as any[];
  if (canonical[0]) return canonical[0];
  const byUsername = await db(env, `federation_actors?username=eq.${encoded}&select=*`) as any[];
  if (byUsername[0]) return byUsername[0];
  return ensureActor(env, username);
}

async function profile(env: any, userId: string) {
  const rows = await db(env, `profiles?id=eq.${encodeURIComponent(userId)}&select=id,username,display_name,avatar_url,bio,website,location,verified_tier,protected_account`) as any[];
  return rows[0] || null;
}

function apResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/activity+json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
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
  if (!row) return apResponse({ error: 'actor not found' }, 404);
  const p = await profile(env, row.user_id);
  if (!p) return apResponse({ error: 'profile not found' }, 404);
  const name = actorName(row, p.username || username), id = `${ORIGIN}/users/${encodeURIComponent(name)}`;
  const displayName = String(p.display_name || name).trim() || name;
  const discoverable = p.protected_account !== true;
  const actor: any = {
    '@context': CTX,
    id,
    type: 'Person',
    preferredUsername: name,
    name: displayName,
    url: id,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    following: `${id}/following`,
    manuallyApprovesFollowers: p.protected_account === true,
    discoverable,
    indexable: discoverable,
    publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: row.public_key_pem },
  };
  if (p.bio) actor.summary = p.bio;
  if (p.website) actor.url = p.website;
  if (p.avatar_url) actor.icon = { type: 'Image', mediaType: 'image/jpeg', url: p.avatar_url };
  if (p.location) actor.location = { type: 'Place', name: p.location };
  if (p.verified_tier && p.verified_tier !== 'none') actor.attachment = [{ type: 'PropertyValue', name: 'Verified', value: p.verified_tier }];
  actor.webfinger = `acct:${name}@${DOMAIN}`;
  return apResponse(actor);
}

async function noteGet(env: any, username: string, noteId: string) {
  const local = await actorRecord(env, username);
  if (!local) return apResponse({ error: 'actor not found' }, 404);
  const rows = await db(env, `posts?id=eq.${encodeURIComponent(noteId)}&author_id=eq.${encodeURIComponent(local.user_id)}&select=*&limit=1`) as any[];
  const post = rows[0];
  if (!post || String(post.visibility || 'public') !== 'public') return apResponse({ error: 'object not found' }, 404);
  const id = `${ORIGIN}/users/${encodeURIComponent(actorName(local, username))}/notes/${encodeURIComponent(noteId)}`;
  const published = post.created_at || post.published_at || new Date().toISOString();
  const tags = Array.isArray(post.hashtags) ? post.hashtags : [];
  return apResponse({ '@context': CTX, id, type: 'Note', attributedTo: local.actor_url, url: id, content: String(post.content || ''), published, to: ['https://www.w3.org/ns/activitystreams#Public'], cc: [`${local.actor_url}/followers`], sensitive: false, ...(tags.length ? { tag: tags } : {}), attachment: Array.isArray(post.media_urls) ? post.media_urls.map((url: string) => ({ type: 'Document', mediaType: 'application/octet-stream', url })) : [] });
}

async function remoteInteractionObject(env: any, request: Request, username: string, interactionId: string) {
  if (request.method !== 'GET') return null;
  const local = await actorRecord(env, username);
  if (!local) return apResponse({ error: 'actor not found' }, 404);
  const rows = await db(env, `federation_remote_interactions?id=eq.${encodeURIComponent(interactionId)}&local_user_id=eq.${encodeURIComponent(local.user_id)}&select=id,interaction_type,status,payload,object_url,activity_uri`) as any[];
  const row = rows[0];
  if (!row || !['reply', 'quote'].includes(String(row.interaction_type))) return apResponse({ error: 'object not found' }, 404);
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : null;
  const object = payload?.object && typeof payload.object === 'object' ? payload.object : null;
  if (!object || typeof object.id !== 'string') return apResponse({ error: 'object not found' }, 404);
  const expectedId = `${ORIGIN}/users/${encodeURIComponent(actorName(local, username))}/remote-interactions/${interactionId}`;
  if (object.id !== expectedId) return apResponse({ error: 'object identity mismatch' }, 409);
  return apResponse({ '@context': Array.isArray(payload['@context']) ? payload['@context'] : CTX, ...object });
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const actorMatch = url.pathname.match(/^\/users\/([^/]+)$/);
    const inboxMatch = url.pathname.match(/^\/users\/([^/]+)\/inbox$/);
    const noteMatch = url.pathname.match(/^\/users\/([^/]+)\/notes\/([^/]+)$/);
    const interactionObjectMatch = url.pathname.match(/^\/users\/([^/]+)\/remote-interactions\/([0-9a-f-]+)$/i);
    if (request.method === 'GET' && url.pathname === '/.well-known/webfinger') return webfinger(env, request);
    if (request.method === 'GET' && actorMatch) return actorGet(env, decodeURIComponent(actorMatch[1]));
    if (request.method === 'GET' && noteMatch) return noteGet(env, decodeURIComponent(noteMatch[1]), decodeURIComponent(noteMatch[2]));
    if (request.method === 'GET' && interactionObjectMatch) return remoteInteractionObject(env, request, decodeURIComponent(interactionObjectMatch[1]), interactionObjectMatch[2]);
    if (request.method === 'POST' && inboxMatch) {
      const handled = await handleFederationInteraction(request, env, decodeURIComponent(inboxMatch[1]));
      if (handled) return handled;
    }
    return federation.fetch(request, env, ctx);
  },
};
