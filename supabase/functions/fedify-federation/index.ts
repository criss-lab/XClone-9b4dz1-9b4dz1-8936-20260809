import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createFederation } from 'npm:@fedify/fedify@2.4.0';

const ORIGIN = Deno.env.get('FEDERATION_ORIGIN') || 'https://federation.testagram.site';
const HOST = new URL(ORIGIN).hostname;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const federation = createFederation({ origin: ORIGIN });
const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';
const AP = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/activity+json';
const CTX = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,accept,digest,signature,date,host',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Cache-Control': 'no-store',
};
const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': `${type}; charset=utf-8` } });

async function profile(username: string) {
  const { data, error } = await db.from('profiles').select('id,username,display_name,full_name,bio,avatar_url,website').eq('username', username).maybeSingle();
  if (error) throw error;
  return data;
}

async function actorRow(username: string) {
  const p = await profile(username);
  if (!p) return null;
  const { data, error } = await db.from('federation_actors').select('public_key_pem,private_key_jwk,actor_url,inbox_url').eq('user_id', p.id).maybeSingle();
  if (error) throw error;
  return { p, key: data };
}

function actorDoc(p: any, key: any) {
  const id = `${ORIGIN}/users/${encodeURIComponent(p.username)}`;
  const doc: Record<string, unknown> = {
    '@context': CTX,
    id,
    type: 'Person',
    preferredUsername: p.username,
    name: p.display_name || p.full_name || p.username,
    summary: p.bio || '',
    url: `https://testagram.site/profile/${encodeURIComponent(p.username)}`,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    following: `${id}/following`,
    endpoints: { sharedInbox: `${ORIGIN}/inbox` },
    discoverable: true,
    indexable: true,
    manuallyApprovesFollowers: false,
    publicKey: {
      id: `${id}#main-key`,
      owner: id,
      publicKeyPem: key?.public_key_pem || '',
    },
  };
  if (p.avatar_url) doc.icon = { type: 'Image', mediaType: 'image/*', url: p.avatar_url };
  if (p.website) doc.attachment = [{ type: 'PropertyValue', name: 'Website', value: p.website }];
  return doc;
}

async function findObject(id: string) {
  for (const table of ['federation_objects', 'federated_objects', 'remote_posts']) {
    for (const field of ['object_url', 'canonical_url', 'uri', 'url', 'id']) {
      const { data, error } = await db.from(table).select('*').eq(field, id).limit(1);
      if (!error && data?.[0]) return { table, row: data[0] };
    }
  }
  return null;
}

function normalizeObject(row: any) {
  const raw = row.raw_object ?? row.object ?? row;
  const id = row.object_url || row.canonical_url || row.uri || row.url || raw.id;
  const actor = row.actor_url || row.actor_uri || raw.attributedTo;
  return {
    '@context': CTX,
    id,
    type: raw.type === 'Article' ? 'Article' : 'Note',
    attributedTo: actor,
    url: id,
    published: row.published_at || row.created_at || raw.published,
    content: row.content || raw.content || '',
    to: raw.to || [PUBLIC],
    cc: raw.cc || (actor ? [`${actor}/followers`] : []),
    sensitive: Boolean(raw.sensitive),
    attachment: Array.isArray(raw.attachment) ? raw.attachment : [],
    tag: Array.isArray(raw.tag) ? raw.tag : [],
  };
}

async function localOutbox(username: string, url: URL) {
  const p = await profile(username);
  if (!p) return null;
  const actor = `${ORIGIN}/users/${encodeURIComponent(username)}`;
  const { data: posts, error } = await db.from('posts').select('id,author_id,user_id,content,created_at,visibility,media_urls,quoted_post_id').or(`author_id.eq.${p.id},user_id.eq.${p.id}`).in('visibility', ['public', 'unlisted']).order('created_at', { ascending: false }).limit(40);
  if (error) throw error;
  const items = (posts || []).map((post: any) => {
    const noteId = `${ORIGIN}/objects/${encodeURIComponent(post.id)}`;
    const note: Record<string, unknown> = {
      '@context': CTX,
      id: noteId,
      type: 'Note',
      attributedTo: actor,
      url: noteId,
      published: post.created_at,
      content: String(post.content || ''),
      to: post.visibility === 'public' ? [PUBLIC] : [`${actor}/followers`],
      cc: post.visibility === 'public' ? [`${actor}/followers`] : [],
      sensitive: false,
      attachment: Array.isArray(post.media_urls)
        ? post.media_urls.map((mediaUrl: string) => ({ type: 'Document', mediaType: 'application/octet-stream', url: mediaUrl }))
        : [],
    };
    if (post.quoted_post_id) note.quoteUrl = `${ORIGIN}/objects/${encodeURIComponent(post.quoted_post_id)}`;
    return {
      '@context': CTX,
      id: `${ORIGIN}/activities/${encodeURIComponent(post.id)}`,
      type: 'Create',
      actor,
      published: post.created_at,
      to: note.to,
      cc: note.cc,
      object: note,
    };
  });
  const page = url.searchParams.get('page') === 'true';
  const collectionId = `${actor}/outbox`;
  if (!page) return { '@context': CTX, id: collectionId, type: 'OrderedCollection', totalItems: items.length, first: `${collectionId}?page=true` };
  return { '@context': CTX, id: `${collectionId}?page=true`, type: 'OrderedCollectionPage', partOf: collectionId, orderedItems: items, totalItems: items.length };
}

async function relationshipCollection(kind: 'followers' | 'following', username: string) {
  const p = await profile(username);
  if (!p) return null;
  const actor = `${ORIGIN}/users/${encodeURIComponent(username)}`;
  if (kind === 'followers') {
    const { data, error } = await db.from('federation_relationships').select('remote_actor_url').eq('user_id', p.id).eq('relationship', 'follower').in('state', ['accepted', 'active']).limit(1000);
    if (error) throw error;
    const items = [...new Set((data || []).map((r: any) => r.remote_actor_url).filter(Boolean))];
    return { '@context': CTX, id: `${actor}/followers`, type: 'OrderedCollection', totalItems: items.length, orderedItems: items };
  }
  const { data, error } = await db.from('federation_relationships').select('remote_actor_url').eq('user_id', p.id).eq('relationship', 'following').in('state', ['accepted', 'active']).limit(1000);
  if (error) throw error;
  const items = [...new Set((data || []).map((r: any) => r.remote_actor_url).filter(Boolean))];
  return { '@context': CTX, id: `${actor}/following`, type: 'OrderedCollection', totalItems: items.length, orderedItems: items };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  const path = u.pathname.replace(/^\/+|\/+$/g, '');
  try {
    if (req.method === 'GET' && (path === '' || path === 'health')) return json({ ok: true, service: 'fedify-federation', framework: 'Fedify', version: '2.4.0', origin: ORIGIN, federationInitialized: Boolean(federation) });
    if (req.method === 'GET' && path === 'capabilities') return json({ ok: true, protocol: 'activitypub', origin: ORIGIN, routes: ['webfinger', 'nodeinfo', 'actor', 'outbox', 'followers', 'following', 'inbox', 'object'], activities: ['Create', 'Update', 'Delete', 'Follow', 'Undo', 'Like', 'Announce', 'Accept', 'Reject', 'Block'] });
    if (req.method === 'GET' && path === '.well-known/webfinger') {
      const resource = u.searchParams.get('resource') || '';
      const m = resource.match(/^acct:([^@]+)@([^:]+)$/i);
      if (!m || m[2].toLowerCase() !== HOST) return json({ error: 'Resource not found' }, 404);
      const p = await profile(m[1]);
      if (!p) return json({ error: 'Resource not found' }, 404);
      const id = `${ORIGIN}/users/${encodeURIComponent(p.username)}`;
      return json({ subject: `acct:${p.username}@${HOST}`, aliases: [id], links: [{ rel: 'self', type: 'application/activity+json', href: id }] });
    }
    if (req.method === 'GET' && path === '.well-known/nodeinfo') return json({ links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: `${ORIGIN}/nodeinfo/2.1` }] });
    if (req.method === 'GET' && path === 'nodeinfo/2.1') {
      const { count } = await db.from('profiles').select('id', { count: 'exact', head: true });
      const { count: posts } = await db.from('posts').select('id', { count: 'exact', head: true }).in('visibility', ['public', 'unlisted']);
      return json({ version: '2.1', software: { name: 'testagram', version: '1.0.0' }, protocols: ['activitypub'], usage: { users: { total: count || 0, activeMonth: count || 0, activeHalfyear: count || 0 }, localPosts: posts || 0 }, openRegistrations: true });
    }
    const am = path.match(/^users\/([^/]+)$/);
    if (req.method === 'GET' && am) {
      const r = await actorRow(decodeURIComponent(am[1]));
      if (!r) return json({ error: 'Actor not found' }, 404);
      return json(actorDoc(r.p, r.key), 200, 'application/activity+json');
    }
    const cm = path.match(/^users\/([^/]+)\/(outbox|followers|following)$/);
    if (req.method === 'GET' && cm) {
      const username = decodeURIComponent(cm[1]);
      const kind = cm[2] as 'outbox' | 'followers' | 'following';
      if (kind === 'outbox') {
        const c = await localOutbox(username, u);
        return c ? json(c, 200, 'application/activity+json') : json({ error: 'Actor not found' }, 404);
      }
      const c = await relationshipCollection(kind, username);
      return c ? json(c, 200, 'application/activity+json') : json({ error: 'Actor not found' }, 404);
    }
    const om = path.match(/^objects\/([^/]+)$/);
    if (req.method === 'GET' && om) {
      const found = await findObject(decodeURIComponent(om[1]));
      return found ? json(normalizeObject(found.row), 200, 'application/activity+json') : json({ error: 'Object not found' }, 404);
    }
    return json({ error: 'Fedify route not found' }, 404);
  } catch (e) {
    console.error('[fedify-federation]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
