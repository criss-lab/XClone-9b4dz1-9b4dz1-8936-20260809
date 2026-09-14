import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { generateKeyPairSync, createVerify } from 'node:crypto';

const ACTIVITY_JSON = 'application/activity+json';
const ACTIVITY_ACCEPT = `${ACTIVITY_JSON}, application/ld+json; profile="https://www.w3.org/ns/activitystreams"`;
const AS_CONTEXT = 'https://www.w3.org/ns/activitystreams';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function admin() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function origin(req: VercelRequest): string {
  const configured = process.env.FEDERATION_DOMAIN?.replace(/\/$/, '');
  if (configured) return configured.startsWith('http') ? configured : `https://${configured}`;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return `${proto}://${host}`;
}

function json(res: VercelResponse, status: number, body: unknown, activity = false) {
  res.status(status).setHeader('Content-Type', activity ? ACTIVITY_JSON : 'application/json');
  res.setHeader('Cache-Control', activity ? 'public, max-age=60, s-maxage=60' : 'no-store');
  return res.send(body);
}

function actorDocument(actor: any) {
  return {
    '@context': [AS_CONTEXT, 'https://w3id.org/security/v1', { toot: 'http://joinmastodon.org/ns#' }],
    id: actor.actor_uri,
    type: 'Person',
    preferredUsername: actor.username,
    name: actor.display_name || actor.username,
    summary: actor.bio || '',
    url: actor.actor_uri,
    inbox: actor.inbox_uri,
    outbox: actor.outbox_uri,
    followers: actor.followers_uri,
    following: actor.following_uri,
    manuallyApprovesFollowers: !!actor.locked,
    discoverable: !!actor.discoverable,
    published: actor.created_at,
    icon: actor.avatar_url ? { type: 'Image', mediaType: 'image/jpeg', url: actor.avatar_url } : undefined,
    image: actor.header_url ? { type: 'Image', mediaType: 'image/jpeg', url: actor.header_url } : undefined,
    publicKey: {
      id: `${actor.actor_uri}#main-key`,
      owner: actor.actor_uri,
      publicKeyPem: actor.public_key_pem,
    },
  };
}

async function lookupActor(db: any, username: string) {
  const { data, error } = await db.from('federation_actors').select('*').eq('username', username).eq('enabled', true).maybeSingle();
  if (error) throw error;
  return data;
}

function parseSignatureHeader(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  for (const part of value.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|([^,\s]+))/g)) {
    out[part[1]] = part[2] ?? part[3] ?? '';
  }
  return out;
}

function signingString(req: VercelRequest, signedHeaders: string[]): string {
  const method = req.method!.toLowerCase();
  const path = req.url!.split('?')[0];
  return signedHeaders.map((name) => {
    const lower = name.toLowerCase();
    if (lower === '(request-target)') return `(request-target): ${method} ${path}`;
    const value = req.headers[lower];
    return `${lower}: ${Array.isArray(value) ? value.join(', ') : String(value ?? '')}`;
  }).join('\n');
}

async function verifyHttpSignature(req: VercelRequest, body: string): Promise<{ valid: boolean; actorUri?: string; reason?: string }> {
  const header = String(req.headers.signature || '');
  const sig = parseSignatureHeader(header);
  if (!sig.keyId || !sig.signature || !sig.headers) return { valid: false, reason: 'missing HTTP Signature fields' };
  if (sig.algorithm && sig.algorithm.toLowerCase() !== 'rsa-sha256') return { valid: false, reason: 'unsupported signature algorithm' };

  const digest = String(req.headers.digest || '');
  if (digest) {
    const match = digest.match(/^SHA-256=(.+)$/i);
    if (match) {
      const expected = Buffer.from(body).toString('base64');
      if (match[1] !== expected) return { valid: false, reason: 'digest mismatch' };
    }
  }

  const keyId = sig.keyId.replace(/^<|>$/g, '');
  const actorUri = keyId.replace(/#.*$/, '');
  const remote = await fetch(actorUri, { headers: { Accept: ACTIVITY_ACCEPT } });
  if (!remote.ok) return { valid: false, reason: `actor fetch failed: ${remote.status}` };
  const actor = await remote.json();
  const pem = actor?.publicKey?.publicKeyPem;
  if (!pem) return { valid: false, reason: 'remote actor has no public key' };

  const verify = createVerify('RSA-SHA256');
  verify.update(signingString(req, sig.headers.split(/\s+/)));
  verify.end();
  const valid = verify.verify(pem, Buffer.from(sig.signature, 'base64'));
  return valid ? { valid: true, actorUri } : { valid: false, reason: 'signature verification failed' };
}

async function provision(req: VercelRequest, res: VercelResponse) {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json(res, 401, { error: 'authentication required' });

  const db = admin();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) return json(res, 401, { error: 'invalid session' });

  const input = typeof req.body === 'object' && req.body ? req.body : {};
  const username = String(input.username || userData.user.user_metadata?.username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,30}$/.test(username)) return json(res, 400, { error: 'a valid federation username is required' });

  const base = origin(req);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const actorUri = `${base}/users/${encodeURIComponent(username)}`;
  const row = {
    user_id: userData.user.id,
    username,
    display_name: String(input.displayName || userData.user.user_metadata?.display_name || username),
    bio: String(input.bio || ''),
    avatar_url: input.avatarUrl || userData.user.user_metadata?.avatar_url || null,
    header_url: input.headerUrl || null,
    public_key_pem: publicKey,
    actor_uri: actorUri,
    inbox_uri: `${actorUri}/inbox`,
    outbox_uri: `${actorUri}/outbox`,
    followers_uri: `${actorUri}/followers`,
    following_uri: `${actorUri}/following`,
    enabled: true,
  };

  const { data: actor, error } = await db.from('federation_actors').upsert(row, { onConflict: 'user_id' }).select('*').single();
  if (error) return json(res, 409, { error: error.message });
  const { error: keyError } = await db.from('federation_actor_keys').upsert({ actor_id: actor.id, private_key_pem: privateKey }, { onConflict: 'actor_id' });
  if (keyError) return json(res, 500, { error: keyError.message });
  return json(res, 200, { actor: actorDocument(actor), username });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const route = String(req.query.route || '').toLowerCase();
    const username = String(req.query.username || '').toLowerCase();
    const db = admin();

    if (route === 'provision' && req.method === 'POST') return provision(req, res);

    if (route === 'webfinger' && req.method === 'GET') {
      const resource = String(req.query.resource || '');
      const match = resource.match(/^acct:([^@]+)@(.+)$/i);
      if (!match) return json(res, 400, { error: 'invalid resource' });
      const actor = await lookupActor(db, match[1].toLowerCase());
      if (!actor) return json(res, 404, { error: 'account not found' });
      const domain = new URL(actor.actor_uri).host;
      if (domain !== match[2].toLowerCase()) return json(res, 404, { error: 'account not found' });
      return json(res, 200, {
        subject: `acct:${actor.username}@${domain}`,
        aliases: [actor.actor_uri],
        links: [
          { rel: 'self', type: ACTIVITY_JSON, href: actor.actor_uri },
          { rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: actor.actor_uri },
        ],
      });
    }

    if (route === 'nodeinfo' && req.method === 'GET') {
      return json(res, 200, { links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0', href: `${origin(req)}/nodeinfo/2.0` }] });
    }

    if (route === 'nodeinfo20' && req.method === 'GET') {
      return json(res, 200, {
        version: '2.0',
        software: { name: 'testagram', version: '1.0.0' },
        protocols: ['activitypub'],
        usage: { users: { total: 0 }, localPosts: 0 },
        openRegistrations: false,
        metadata: { federation: true },
      });
    }

    const actor = username ? await lookupActor(db, username) : null;
    if (!actor) return json(res, 404, { error: 'federation actor not found' });

    if (route === 'actor' && req.method === 'GET') return json(res, 200, actorDocument(actor), true);

    if (route === 'outbox' && req.method === 'GET') {
      const { data: objects, error } = await db.from('federation_objects').select('payload,object_uri,activity_uri,published_at').eq('actor_uri', actor.actor_uri).eq('local', true).order('published_at', { ascending: false }).limit(40);
      if (error) return json(res, 500, { error: error.message });
      return json(res, 200, {
        '@context': AS_CONTEXT,
        id: actor.outbox_uri,
        type: 'OrderedCollection',
        totalItems: objects?.length || 0,
        orderedItems: (objects || []).map((x: any) => x.payload || x.object_uri),
      }, true);
    }

    if (route === 'followers' && req.method === 'GET') {
      const { data: followers, error } = await db.from('federation_followers').select('remote_actor_uri').eq('local_actor_id', actor.id).eq('state', 'accepted').limit(500);
      if (error) return json(res, 500, { error: error.message });
      return json(res, 200, { '@context': AS_CONTEXT, id: actor.followers_uri, type: 'OrderedCollection', totalItems: followers?.length || 0, orderedItems: (followers || []).map((x: any) => x.remote_actor_uri) }, true);
    }

    if (route === 'following' && req.method === 'GET') {
      return json(res, 200, { '@context': AS_CONTEXT, id: actor.following_uri, type: 'OrderedCollection', totalItems: 0, orderedItems: [] }, true);
    }

    if (route === 'inbox' && req.method === 'POST') {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      const signature = await verifyHttpSignature(req, raw);
      const activity = JSON.parse(raw);
      const activityUri = typeof activity.id === 'string' ? activity.id : null;
      const { error: inboxError } = await db.from('federation_inbox').upsert({
        local_actor_id: actor.id,
        activity_uri: activityUri,
        actor_uri: typeof activity.actor === 'string' ? activity.actor : activity.actor?.id,
        activity_type: activity.type,
        payload: activity,
        signature_valid: signature.valid,
        processed: false,
        error: signature.valid ? null : signature.reason,
      }, { onConflict: 'activity_uri' });
      if (inboxError) return json(res, 500, { error: inboxError.message });
      if (!signature.valid) return json(res, 401, { error: signature.reason || 'invalid signature' });

      const remoteActor = signature.actorUri || (typeof activity.actor === 'string' ? activity.actor : activity.actor?.id);
      if (activity.type === 'Follow' && remoteActor) {
        const remote = await fetch(remoteActor, { headers: { Accept: ACTIVITY_ACCEPT } });
        const remoteJson = remote.ok ? await remote.json() : {};
        await db.from('federation_followers').upsert({
          local_actor_id: actor.id,
          remote_actor_uri: remoteActor,
          remote_inbox_uri: remoteJson.inbox,
          remote_shared_inbox_uri: remoteJson.endpoints?.sharedInbox || null,
          state: 'accepted',
        }, { onConflict: 'local_actor_id,remote_actor_uri' });
        const acceptId = `${actor.actor_uri}/activities/${crypto.randomUUID()}`;
        await db.from('federation_deliveries').insert({ actor_id: actor.id, activity_uri: acceptId, target_inbox: remoteJson.inbox, payload: { '@context': AS_CONTEXT, id: acceptId, type: 'Accept', actor: actor.actor_uri, object: activity } });
      }

      if (activity.type === 'Create' && activity.object?.id) {
        const object = activity.object;
        await db.from('federation_objects').upsert({
          object_uri: object.id,
          activity_uri: activity.id || null,
          actor_uri: remoteActor,
          object_type: object.type || 'Note',
          local: false,
          payload: object,
          published_at: object.published || new Date().toISOString(),
        }, { onConflict: 'object_uri' });
      }

      if (activity.type === 'Undo' && activity.object?.type === 'Follow') {
        await db.from('federation_followers').update({ state: 'removed' }).eq('local_actor_id', actor.id).eq('remote_actor_uri', remoteActor);
      }
      await db.from('federation_inbox').update({ processed: true, processed_at: new Date().toISOString() }).eq('activity_uri', activityUri);
      return res.status(202).send('');
    }

    return json(res, 404, { error: 'unknown federation route' });
  } catch (error: any) {
    console.error('federation handler failure', error);
    return json(res, 500, { error: 'federation internal error' });
  }
}
