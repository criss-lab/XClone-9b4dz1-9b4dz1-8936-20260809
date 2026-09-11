import federation from './federation-entrypoint';

const ORIGIN = 'https://federation.testagram.site';
const GATEWAY = 'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/gateway-relay';
const DISCOVERY = 'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/federation-discovery';
const AP = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/activity+json';
const CTX = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];
const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

async function db(env: any, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_SECRET_KEY);
  headers.set('Authorization', `Bearer ${env.SUPABASE_SECRET_KEY}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`db ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

async function currentUser(env: any, request: Request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization },
  });
  if (!response.ok) return null;
  return await response.json();
}

async function localActor(env: any, userId: string) {
  const response = await db(env, `federation_actors?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  return (await response.json() as any[])[0] || null;
}

async function actor(env: any, username: string) {
  const canonicalUrl = `${ORIGIN}/users/${encodeURIComponent(username)}`;
  const query = `or=(username.eq.${encodeURIComponent(username)},actor_url.eq.${encodeURIComponent(canonicalUrl)})&select=*`;
  const response = await db(env, `federation_actors?${query}`);
  const rows = await response.json() as any[];
  const row = rows[0];
  if (!row) return new Response(JSON.stringify({ error: 'actor not found' }), { status: 404, headers: { 'Content-Type': AP } });
  const actorName = String(row.username || row.preferred_username || username);
  const id = `${ORIGIN}/users/${encodeURIComponent(actorName)}`;
  return new Response(JSON.stringify({
    '@context': CTX,
    id,
    type: 'Person',
    preferredUsername: actorName,
    name: actorName,
    url: id,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    following: `${id}/following`,
    manuallyApprovesFollowers: false,
    discoverable: true,
    indexable: true,
    publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: row.public_key_pem },
  }), { status: 200, headers: { 'Content-Type': AP, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

function tags(content: string) {
  return [...new Set([...content.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)].map(match => match[2].toLowerCase()))]
    .map(tag => ({ type: 'Hashtag', name: `#${tag}`, href: `${ORIGIN}/tags/${encodeURIComponent(tag)}` }));
}

function attachments(media: unknown) {
  if (!Array.isArray(media)) return [];
  return media.map((item: any) => {
    const url = typeof item === 'string' ? item : item?.url || item?.publicUrl || item?.media_url;
    if (!url) return null;
    const mediaType = typeof item === 'object' ? item?.mime_type || item?.mimeType || undefined : undefined;
    const type = mediaType?.startsWith('video/') ? 'Video' : mediaType?.startsWith('audio/') ? 'Audio' : 'Image';
    return { type, mediaType, url };
  }).filter(Boolean);
}

function note(actorRow: any, post: any) {
  const id = `${ORIGIN}/users/${encodeURIComponent(actorRow.username)}/statuses/${encodeURIComponent(post.id)}`;
  const followers = `${ORIGIN}/users/${encodeURIComponent(actorRow.username)}/followers`;
  return {
    '@context': CTX,
    id,
    type: 'Note',
    attributedTo: actorRow.actor_url,
    content: String(post.content || ''),
    published: post.created_at,
    updated: post.updated_at || post.created_at,
    url: `https://testagram.site/post/${encodeURIComponent(post.id)}`,
    to: [PUBLIC],
    cc: [followers],
    tag: tags(String(post.content || '')),
    attachment: attachments(post.media_urls),
    sensitive: false,
  };
}

async function signedGet(local: any, url: string) {
  const target = new URL(url), date = new Date().toUTCString();
  const key = await crypto.subtle.importKey('jwk', local.private_key_jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const canonical = `(request-target): get ${target.pathname}${target.search}\nhost: ${target.host}\ndate: ${date}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(canonical));
  return fetch(url, { headers: { Date: date, Accept: AP, Signature: `keyId="${local.actor_url}#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="${btoa(String.fromCharCode(...new Uint8Array(signature)))}"`, 'User-Agent': 'Testagram-Federation/3.0' } });
}

async function remoteActor(local: any, url: string) {
  const response = await signedGet(local, url), text = await response.text();
  if (!response.ok) throw new Error(`remote actor ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function signedPost(local: any, url: string, body: string) {
  const target = new URL(url), date = new Date().toUTCString();
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const digest = `sha-256=${btoa(String.fromCharCode(...new Uint8Array(digestBytes)))}`;
  const key = await crypto.subtle.importKey('jwk', local.private_key_jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const canonical = `(request-target): post ${target.pathname}${target.search}\nhost: ${target.host}\ndate: ${date}\ndigest: ${digest}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(canonical));
  return fetch(url, { method: 'POST', body, headers: { Date: date, Digest: digest, Accept: AP, 'Content-Type': 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"', Signature: `keyId="${local.actor_url}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${btoa(String.fromCharCode(...new Uint8Array(signature)))}"`, 'User-Agent': 'Testagram-Federation/3.0' } });
}

async function publish(request: Request, env: any) {
  const user = await currentUser(env, request);
  if (!user?.id) return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const body = await request.json() as { post_id?: string };
  if (!body.post_id) return new Response(JSON.stringify({ error: 'post_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const local = await localActor(env, user.id);
  if (!local) return new Response(JSON.stringify({ error: 'Federation actor not provisioned' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  const postResponse = await db(env, `posts?id=eq.${encodeURIComponent(body.post_id)}&author_id=eq.${encodeURIComponent(user.id)}&visibility=eq.public&select=*`);
  const posts = await postResponse.json() as any[];
  if (!posts[0]) return new Response(JSON.stringify({ error: 'Public post not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  const post = posts[0], object = note(local, post), activity = { '@context': CTX, id: `${object.id}/activity`, type: 'Create', actor: local.actor_url, published: post.created_at, to: [PUBLIC], cc: [object.cc[0]], object };
  const followersResponse = await db(env, `federation_relationships?local_user_id=eq.${encodeURIComponent(user.id)}&relationship=eq.follower&state=eq.accepted&select=remote_actor_uri`);
  const followers = await followersResponse.json() as any[];
  const results = await Promise.allSettled(followers.map(async row => {
    const actorUrl = String(row.remote_actor_uri || '');
    if (!actorUrl) throw new Error('Follower actor URI missing');
    const remote = await remoteActor(local, actorUrl), inbox = remote.endpoints?.sharedInbox || remote.inbox;
    if (!inbox) throw new Error(`Remote actor has no inbox: ${actorUrl}`);
    const response = await signedPost(local, inbox, JSON.stringify(activity)), text = await response.text();
    await db(env, 'federation_outbox', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: user.id, activity_id: activity.id, activity_type: 'Create', actor_url: local.actor_url, inbox_url: inbox, payload: activity, status: response.ok ? 'delivered' : response.status >= 500 ? 'pending' : 'failed', attempts: 1, last_attempt_at: new Date().toISOString(), next_attempt_at: response.ok ? null : new Date(Date.now() + 60000).toISOString(), http_status: response.status, last_error: response.ok ? null : text.slice(0, 1200) }) });
    if (!response.ok) throw new Error(`Create delivery ${response.status}: ${text.slice(0, 500)}`);
    return { actor: actorUrl, inbox, status: response.status };
  }));
  const delivered = results.filter(result => result.status === 'fulfilled').length;
  return new Response(JSON.stringify({ ok: true, activityId: activity.id, followers: results.length, delivered, failed: results.length - delivered }), { status: 202, headers: { 'Content-Type': 'application/json' } });
}

async function webfinger(request: Request) {
  const url = new URL(request.url), resource = url.searchParams.get('resource') || '';
  const upstream = await fetch(`${GATEWAY}/.well-known/webfinger?resource=${encodeURIComponent(resource)}`, { headers: { Accept: 'application/jrd+json, application/json', 'User-Agent': 'Testagram-Federation/3.0' } });
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/jrd+json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept' } });
}

async function inbox(request: Request, username: string) {
  const body = await request.arrayBuffer(), headers = new Headers(request.headers);
  headers.set('Content-Type', headers.get('Content-Type') || 'application/activity+json');
  const response = await fetch(`${GATEWAY}/users/${encodeURIComponent(username)}/inbox`, { method: 'POST', headers, body });
  return new Response(response.body, { status: response.status, headers: response.headers });
}

async function discovery(request: Request) {
  const url = new URL(request.url), target = `${DISCOVERY}${url.pathname}${url.search}`;
  const response = await fetch(target, { headers: { Accept: AP, 'User-Agent': 'Testagram-Federation/3.0' } });
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/activity+json; charset=utf-8', 'Cache-Control': response.headers.get('Cache-Control') || 'public, max-age=30, s-maxage=60', Vary: 'Accept' } });
  }

export default { async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url), actorMatch = url.pathname.match(/^\/users\/([^/]+)$/), inboxMatch = url.pathname.match(/^\/users\/([^/]+)\/inbox$/);
  if (request.method === 'POST' && url.pathname === '/api/federation/publish') return publish(request, env);
  if (request.method === 'GET' && url.pathname === '/.well-known/webfinger') return webfinger(request);
  if (request.method === 'GET' && actorMatch) return actor(env, decodeURIComponent(actorMatch[1]));
  if (request.method === 'POST' && inboxMatch) return inbox(request, decodeURIComponent(inboxMatch[1]));
  if (request.method === 'GET' && (/^\/users\/[^/]+\/outbox$/.test(url.pathname) || /^\/users\/[^/]+\/statuses\/[^/]+$/.test(url.pathname) || /^\/objects\/posts\/[^/]+$/.test(url.pathname) || /^\/tags\/[^/]+$/.test(url.pathname))) return discovery(request);
  return federation.fetch(request, env, ctx);
} };
