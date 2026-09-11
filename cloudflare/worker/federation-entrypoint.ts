import worker from './index';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_PROJECT_REF: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SECRET_KEY: string;
  SUPABASE_JWKS_URL: string;
  APP_ORIGIN: string;
  MEDIA: R2Bucket;
}

const DOMAIN = 'federation.testagram.site';
const ORIGIN = `https://${DOMAIN}`;
const AP = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/activity+json';
const CTX = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];

const enc = (s: string) => encodeURIComponent(s);
const b64 = (x: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(x)));
const ub64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function ap(body: unknown, status = 200) {
  return json(body, status, {
    'Content-Type': 'application/activity+json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
}

async function db(e: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', e.SUPABASE_SECRET_KEY);
  headers.set('Authorization', `Bearer ${e.SUPABASE_SECRET_KEY}`);
  headers.set('Content-Type', 'application/json');
  const r = await fetch(`${e.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!r.ok) throw new Error(`db ${r.status}: ${(await r.text()).slice(0, 500)}`);
  return r;
}

async function actor(e: Env, username: string) {
  const r = await db(e, `federation_actors?username=eq.${enc(username)}&select=*`);
  return (await r.json() as any[])[0] || null;
}

async function signedGet(local: any, url: string) {
  const u = new URL(url);
  const date = new Date().toUTCString();
  const key = await crypto.subtle.importKey(
    'jwk', local.private_key_jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const canonical = `(request-target): get ${u.pathname}${u.search}\nhost: ${u.host}\ndate: ${date}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(canonical));
  return fetch(url, {
    headers: {
      Date: date,
      Accept: AP,
      Signature: `keyId="${local.actor_url}#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="${b64(signature)}"`,
      'User-Agent': 'Testagram-Federation/1.5',
    },
  });
}

async function remote(e: Env, local: any, url: string) {
  const r = await signedGet(local, url);
  const text = await r.text();
  if (!r.ok) throw new Error(`remote actor ${r.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

function sigParts(value: string) {
  const out: Record<string, string> = {};
  for (const part of value.split(/,(?=\w+=)/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

async function verifySignature(e: Env, req: Request, body: string, local: any) {
  const signatureHeader = req.headers.get('Signature');
  const date = req.headers.get('Date');
  const digest = req.headers.get('Digest');
  if (!signatureHeader || !date || !digest) throw new Error('Missing ActivityPub signature headers');

  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 12 * 60 * 60 * 1000) {
    throw new Error('Stale ActivityPub signature');
  }

  const expectedDigest = `sha-256=${b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))}`;
  if (digest !== expectedDigest && digest !== expectedDigest.replace('sha-256=', 'SHA-256=')) {
    throw new Error('Digest mismatch');
  }

  const parsed = sigParts(signatureHeader);
  if (!parsed.keyId || !parsed.signature) throw new Error('Malformed ActivityPub signature');

  const remoteActorUri = parsed.keyId.split('#')[0];
  const remoteActor = await remote(e, local, remoteActorUri);
  const pem = remoteActor.publicKey?.publicKeyPem;
  if (!pem) throw new Error('Remote actor has no public key');

  const key = await crypto.subtle.importKey(
    'spki',
    ub64(pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );

  const url = new URL(req.url);
  const lines: string[] = [];
  for (const header of (parsed.headers || '(request-target) host date digest').split(' ')) {
    if (header === '(request-target)') lines.push(`(request-target): ${req.method.toLowerCase()} ${url.pathname}${url.search}`);
    else if (header === 'host') lines.push(`host: ${url.host}`);
    else if (header === 'date') lines.push(`date: ${date}`);
    else if (header === 'digest') lines.push(`digest: ${digest}`);
    else lines.push(`${header}: ${req.headers.get(header) || ''}`);
  }

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, ub64(parsed.signature), new TextEncoder().encode(lines.join('\n')),
  );
  if (!valid) throw new Error('Invalid ActivityPub HTTP signature');
  return { remoteActorUri, remoteActor };
}

async function signPost(local: any, url: string, body: string) {
  const u = new URL(url);
  const date = new Date().toUTCString();
  const digest = `sha-256=${b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))}`;
  const key = await crypto.subtle.importKey(
    'jwk', local.private_key_jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const canonical = `(request-target): post ${u.pathname}${u.search}\nhost: ${u.host}\ndate: ${date}\ndigest: ${digest}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(canonical));
  return fetch(url, {
    method: 'POST',
    body,
    headers: {
      Date: date,
      Digest: digest,
      Accept: AP,
      'Content-Type': AP,
      Signature: `keyId="${local.actor_url}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${b64(signature)}"`,
      'User-Agent': 'Testagram-Federation/1.5',
    },
  });
}

async function deliverAccept(local: any, follow: any, remoteActor: any) {
  const inbox = remoteActor.endpoints?.sharedInbox || remoteActor.inbox;
  if (!inbox) throw new Error('Remote actor has no inbox');
  const acceptId = `${local.actor_url}/accepts/${encodeURIComponent(String(follow.id))}`;
  const activity = {
    '@context': CTX,
    id: acceptId,
    type: 'Accept',
    actor: local.actor_url,
    object: follow.id,
  };
  const response = await signPost(local, inbox, JSON.stringify(activity));
  const text = await response.text();
  if (!response.ok) throw new Error(`Accept delivery ${response.status}: ${text.slice(0, 500)}`);
  return { inbox, status: response.status };
}

async function webfinger(e: Env, req: Request) {
  const resource = new URL(req.url).searchParams.get('resource') || '';
  const value = resource.replace(/^acct:/, '').replace(/^@/, '');
  const [username, domain] = value.split('@');
  if (!username || domain !== DOMAIN) return json({ error: 'actor not found' }, 404);
  const row = await actor(e, username);
  if (!row) return json({ error: 'actor not found' }, 404);
  const id = `${ORIGIN}/users/${enc(row.username)}`;
  return json({ subject: `acct:${row.username}@${DOMAIN}`, aliases: [id], links: [{ rel: 'self', type: 'application/activity+json', href: id }] });
}

async function actorGet(e: Env, username: string) {
  const row = await actor(e, username);
  if (!row) return ap({ error: 'actor not found' }, 404);
  const id = `${ORIGIN}/users/${enc(row.username)}`;
  return ap({
    '@context': CTX,
    id,
    type: 'Person',
    preferredUsername: row.username,
    name: row.username,
    url: id,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    following: `${id}/following`,
    manuallyApprovesFollowers: false,
    discoverable: true,
    indexable: true,
    publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: row.public_key_pem },
  });
}

async function persistInbound(e: Env, activity: any, remoteActorUri: string) {
  try {
    await db(e, 'federation_inbox', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        activity_id: String(activity.id),
        activity_type: String(activity.type || 'Unknown'),
        actor_url: remoteActorUri,
        payload: activity,
        processing_status: 'received',
        received_at: new Date().toISOString(),
      }),
    });
    return false;
  } catch (error) {
    if (String(error).includes('db 409')) return true;
    throw error;
  }
}

async function markInbound(e: Env, activityId: string, status: 'processed' | 'rejected' | 'failed', error?: string) {
  await db(e, `federation_inbox?activity_id=eq.${enc(activityId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      processing_status: status,
      ...(status === 'processed' ? { processed_at: new Date().toISOString(), error: null } : {}),
      ...(error ? { error: error.slice(0, 1000) } : {}),
    }),
  });
}

async function inbox(e: Env, req: Request, username: string) {
  if (req.method !== 'POST') return ap({ error: 'ActivityPub inbox requires POST' }, 405);
  const local = await actor(e, username);
  if (!local) return ap({ error: 'actor not found' }, 404);

  const body = await req.text();
  let activity: any;
  let activityId = '';
  try {
    const { remoteActorUri, remoteActor } = await verifySignature(e, req, body, local);
    activity = JSON.parse(body);
    activityId = String(activity.id || '');
    if (!activityId) return ap({ error: 'activity id required' }, 400);

    const duplicate = await persistInbound(e, activity, remoteActorUri);
    if (duplicate) return ap({ ok: true, duplicate: true }, 202);

    if (activity.type === 'Follow') {
      const target = typeof activity.object === 'string' ? activity.object : activity.object?.id;
      if (target !== local.actor_url) {
        await markInbound(e, activityId, 'rejected', 'Follow target mismatch');
        return ap({ error: 'Follow target mismatch' }, 400);
      }
      if (remoteActor.id !== remoteActorUri || activity.actor !== remoteActorUri) {
        await markInbound(e, activityId, 'rejected', 'Follow actor/signature mismatch');
        return ap({ error: 'Follow actor/signature mismatch' }, 401);
      }

      const existing = await db(e, `federation_relationships?local_user_id=eq.${enc(local.user_id)}&remote_actor_uri=eq.${enc(remoteActorUri)}&relationship=eq.follower&select=id&limit=1`).then(r => r.json() as Promise<any[]>);
      await db(e, 'federation_relationships?on_conflict=local_user_id,remote_actor_uri,relationship', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          local_user_id: local.user_id,
          remote_actor_uri: remoteActorUri,
          relationship: 'follower',
          state: 'accepted',
          updated_at: new Date().toISOString(),
        }),
      });

      const delivery = await deliverAccept(local, activity, remoteActor);
      await markInbound(e, activityId, 'processed');
      return ap({ ok: true, accepted: true, duplicate: existing.length > 0, delivery }, 202);
    }

    if (activity.type === 'Accept' || activity.type === 'Reject') {
      const followId = typeof activity.object === 'string' ? activity.object : activity.object?.id;
      if (!followId) {
        await markInbound(e, activityId, 'rejected', 'Accept/Reject object id required');
        return ap({ error: 'Accept/Reject object id required' }, 400);
      }
      const rows = await db(e, `federation_relationships?activity_id=eq.${enc(followId)}&select=user_id,remote_actor_url,local_user_id,remote_actor_uri`).then(r => r.json() as Promise<any[]>);
      if (!rows[0]) {
        await markInbound(e, activityId, 'failed', 'No outbound relationship matched inbound Accept/Reject');
        return ap({ ok: true, received: true, relationshipMatched: false }, 202);
      }
      const row = rows[0];
      const uid = row.user_id || row.local_user_id;
      const remoteUrl = row.remote_actor_url || row.remote_actor_uri;
      const patch = {
        relationship: activity.type === 'Accept' ? 'accepted' : 'rejected',
        state: activity.type === 'Accept' ? 'accepted' : 'rejected',
        updated_at: new Date().toISOString(),
        last_error: null,
      };
      if (row.user_id && row.remote_actor_url) {
        await db(e, `federation_relationships?user_id=eq.${enc(uid)}&remote_actor_url=eq.${enc(remoteUrl)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      }
      if (row.local_user_id && row.remote_actor_uri) {
        await db(e, `federation_relationships?local_user_id=eq.${enc(uid)}&remote_actor_uri=eq.${enc(remoteUrl)}`, { method: 'PATCH', body: JSON.stringify({ relationship: patch.relationship, state: patch.state, updated_at: patch.updated_at }) });
      }
      await markInbound(e, activityId, 'processed');
      return ap({ ok: true, received: true, relationshipMatched: true }, 202);
    }

    await markInbound(e, activityId, 'processed');
    return ap({ ok: true, received: true }, 202);
  } catch (error) {
    console.error('ActivityPub inbox error', error);
    if (activityId) {
      try { await markInbound(e, activityId, 'failed', error instanceof Error ? error.message : 'Inbox processing failed'); } catch (_) { /* preserve original failure */ }
    }
    return ap({ error: error instanceof Error ? error.message : 'Inbox processing failed' }, 401);
  }
}

async function followersGet(e: Env, username: string) {
  const local = await actor(e, username);
  if (!local) return ap({ error: 'actor not found' }, 404);
  const rows = await db(e, `federation_relationships?local_user_id=eq.${enc(local.user_id)}&relationship=eq.follower&state=eq.accepted&select=remote_actor_uri&order=updated_at.desc`).then(r => r.json() as Promise<any[]>);
  const items = rows.map(row => row.remote_actor_uri).filter(Boolean);
  return ap({
    '@context': CTX,
    id: `${ORIGIN}/users/${enc(username)}/followers`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  });
}

async function nodeinfo(e: Env) {
  const rows = await db(e, 'federation_actors?select=user_id').then(r => r.json() as Promise<any[]>).catch(() => []);
  return json({ version: '2.1', software: { name: 'Testagram', version: '1.0.0', repository: 'https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809' }, protocols: ['activitypub'], usage: { users: { total: rows.length }, localPosts: 0, localComments: 0 }, openRegistrations: true, metadata: { federation: true, domain: DOMAIN } });
}

export default {
  async fetch(req: Request, e: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') return json({ ok: true, service: 'testagram-federation', federation: true, federationDomain: DOMAIN, database: 'supabase', supabaseProjectRef: e.SUPABASE_PROJECT_REF, edge: 'cloudflare' });
    if (url.pathname === '/.well-known/webfinger') return webfinger(e, req);
    if (url.pathname === '/.well-known/nodeinfo') return json({ links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: `${ORIGIN}/nodeinfo/2.1` }] });
    if (url.pathname === '/.well-known/host-meta') return new Response(`<?xml version="1.0"?><XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0"><Link rel="lrdd" type="application/xrd+xml" template="${ORIGIN}/.well-known/webfinger?resource={uri}"/></XRD>`, { headers: { 'Content-Type': 'application/xrd+xml; charset=utf-8' } });
    if (url.pathname === '/nodeinfo/2.1') return nodeinfo(e);

    const match = url.pathname.match(/^\/users\/([^/]+)(?:\/(inbox|outbox|followers|following))?$/);
    if (match) {
      const name = decodeURIComponent(match[1]);
      if (match[2] === 'inbox') return inbox(e, req, name);
      if (match[2] === 'followers') return followersGet(e, name);
      if (match[2]) return ap({ '@context': 'https://www.w3.org/ns/activitystreams', id: `${ORIGIN}/users/${enc(name)}/${match[2]}`, type: match[2] === 'outbox' ? 'OrderedCollection' : 'Collection', totalItems: 0, orderedItems: [] });
      return actorGet(e, name);
    }
    return worker.fetch(req, e, ctx);
  },
};