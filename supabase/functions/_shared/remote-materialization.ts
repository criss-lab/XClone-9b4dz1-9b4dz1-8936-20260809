import { actorKeyMatches, assertFederationUrl, federationFetch, federationJson } from './federation-security.ts';

const CTX = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];
const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';
const MAX_POSTS = 30;
const MAX_PAGES = 3;
const MAX_REPLY_DEPTH = 2;

const text = (v: unknown) => typeof v === 'string' ? v : '';
const uri = (v: unknown) => typeof v === 'string' ? v : v && typeof v === 'object' ? text((v as Record<string, unknown>).id) : '';
const now = () => new Date().toISOString();

function actorHandle(actor: any): string {
  const username = text(actor?.preferredUsername || actor?.name || 'unknown').trim();
  return username ? `${username}@${new URL(text(actor.id)).hostname}` : text(actor.id);
}

async function webFinger(acct: string): Promise<string> {
  const clean = acct.replace(/^@/, '').trim();
  const m = clean.match(/^([^@]+)@([^@]+)$/);
  if (!m) throw new Error('Fediverse handle must look like @user@domain');
  const domain = m[2].toLowerCase();
  const url = `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${m[1]}@${domain}`)}`;
  const r = await federationFetch(url, { headers: { Accept: 'application/jrd+json, application/json;q=0.9' } });
  if (!r.ok) throw new Error(`WebFinger failed: HTTP ${r.status}`);
  const descriptor = await r.json();
  if (descriptor?.subject !== `acct:${m[1]}@${domain}`) throw new Error('WebFinger subject mismatch');
  const self = Array.isArray(descriptor.links) ? descriptor.links.find((l: any) => l?.rel === 'self' && typeof l?.href === 'string' && /activity\+json|ld\+json/.test(l?.type || '')) : null;
  const actor = text(self?.href) || (Array.isArray(descriptor.aliases) ? descriptor.aliases.find((v: any) => typeof v === 'string' && /^https:\/\//i.test(v)) : '');
  if (!actor) throw new Error('WebFinger did not return an ActivityPub actor');
  return actor;
}

async function upsertInstance(admin: any, actorUri: string, actor: any) {
  const host = new URL(actorUri).hostname.toLowerCase();
  const software = actor?.endpoints?.sharedInbox ? 'activitypub' : 'activitypub';
  const { data, error } = await admin.from('federated_instances').upsert({
    domain: host,
    software_name: software,
    protocol: 'activitypub',
    status: 'active',
    last_seen_at: now(),
    updated_at: now(),
  }, { onConflict: 'domain' }).select('id').maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function persistRemoteActor(admin: any, actor: any): Promise<any> {
  const actorUri = uri(actor?.id);
  if (!actorUri || !actorKeyMatches(actor, actorUri)) throw new Error('Remote actor identity or public key is invalid');
  const u = await assertFederationUrl(actorUri);
  const instanceId = await upsertInstance(admin, actorUri, actor);
  const icon = actor?.icon;
  const image = actor?.image;
  const iconUrl = typeof icon === 'string' ? icon : text(icon?.url || icon?.href);
  const headerUrl = typeof image === 'string' ? image : text(image?.url || image?.href);
  const aliases = Array.isArray(actor?.alsoKnownAs) ? actor.alsoKnownAs : [];
  const { data, error } = await admin.from('federated_actors').upsert({
    instance_id: instanceId,
    uri: actorUri,
    webfinger: actorHandle(actor),
    preferred_username: text(actor.preferredUsername) || text(actor.name) || actorUri,
    display_name: text(actor.name) || text(actor.preferredUsername) || actorUri,
    summary: text(actor.summary),
    avatar_url: iconUrl || null,
    header_url: headerUrl || null,
    actor_type: text(actor.type) || 'Person',
    inbox_url: text(actor.inbox),
    shared_inbox_url: text(actor?.endpoints?.sharedInbox),
    outbox_url: text(actor.outbox),
    followers_url: text(actor.followers),
    following_url: text(actor.following),
    public_key_id: text(actor?.publicKey?.id),
    public_key_pem: text(actor?.publicKey?.publicKeyPem),
    discoverable: actor?.discoverable !== false,
    locked: Boolean(actor?.manuallyApprovesFollowers),
    raw_actor: actor,
    fetched_at: now(),
    updated_at: now(),
  }, { onConflict: 'uri' }).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Remote actor was not persisted');
  return { ...data, aliases, host: u.hostname.toLowerCase() };
}

function collectionItems(collection: any): any[] {
  const values = collection?.orderedItems ?? collection?.items ?? [];
  return Array.isArray(values) ? values : [];
}

async function persistObject(admin: any, actorUri: string, object: any, instanceId: string | null): Promise<any | null> {
  const objectUri = uri(object?.id);
  if (!objectUri || !/^https:\/\//i.test(objectUri)) return null;
  const attributed = uri(object?.attributedTo) || actorUri;
  if (attributed !== actorUri) throw new Error('Remote object attribution mismatch');
  const type = text(object?.type) || 'Object';
  if (!['Note', 'Article', 'Question', 'Video', 'Image'].includes(type)) return null;
  const { data, error } = await admin.from('federated_objects').upsert({
    uri: objectUri,
    object_type: type,
    actor_uri: actorUri,
    instance_id: instanceId,
    url: typeof object.url === 'string' ? object.url : objectUri,
    content: text(object.content) || text(object.name),
    summary: text(object.summary) || null,
    published_at: object.published ? new Date(object.published).toISOString() : null,
    updated_at: object.updated ? new Date(object.updated).toISOString() : null,
    sensitive: Boolean(object.sensitive),
    in_reply_to_uri: uri(object.inReplyTo) || null,
    quote_uri: uri(object.quote) || null,
    language_code: text(object.language) || null,
    attachments: Array.isArray(object.attachment) ? object.attachment : [],
    tags: Array.isArray(object.tag) ? object.tag : [],
    raw_object: object,
  }, { onConflict: 'uri' }).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchCollectionPage(url: string): Promise<any> {
  return await federationJson(url, { headers: { Accept: 'application/activity+json, application/ld+json, application/json' } });
}

async function fetchObjectIfNeeded(admin: any, actorUri: string, objectUri: string, instanceId: string | null, depth: number): Promise<void> {
  if (depth > MAX_REPLY_DEPTH || !objectUri || !/^https:\/\//i.test(objectUri)) return;
  const existing = await admin.from('federated_objects').select('uri').eq('uri', objectUri).maybeSingle();
  if (existing.data?.uri) return;
  const object = await federationJson(objectUri);
  const owner = uri(object?.attributedTo);
  if (owner && owner !== actorUri) return;
  const persisted = await persistObject(admin, actorUri, object, instanceId);
  const parent = uri(object?.inReplyTo);
  if (persisted && parent) await fetchObjectIfNeeded(admin, actorUri, parent, instanceId, depth + 1);
}

export async function persistRemoteActorPosts(admin: any, actor: any, requested = 10): Promise<number> {
  const actorUri = uri(actor?.id);
  const outbox = text(actor?.outbox);
  if (!actorUri || !outbox) return 0;
  const actorRow = await persistRemoteActor(admin, actor);
  const limit = Math.min(Math.max(Number(requested || 10), 1), MAX_POSTS);
  let next: string | null = outbox;
  let count = 0;
  for (let page = 0; page < MAX_PAGES && next && count < limit; page++) {
    const collection = await fetchCollectionPage(next);
    for (const item of collectionItems(collection)) {
      const activity = text(item?.type) === 'Create' ? item : null;
      const object = activity?.object ?? (item?.type ? item : null);
      const objectActor = uri(object?.attributedTo);
      if (!object || (objectActor && objectActor !== actorUri)) continue;
      const saved = await persistObject(admin, actorUri, object, actorRow.instance_id);
      if (saved) {
        count++;
        const parent = uri(object.inReplyTo);
        if (parent) await fetchObjectIfNeeded(admin, actorUri, parent, actorRow.instance_id, 1).catch(() => undefined);
      }
      if (count >= limit) break;
    }
    const nextValue = typeof collection?.next === 'string' ? collection.next : text(collection?.next?.id);
    next = nextValue || null;
  }
  return count;
}

export async function resolveRemoteActor(admin: any, acctOrActor: string, fetchPosts = 10) {
  const value = acctOrActor.trim();
  const actorUri = /^https:\/\//i.test(value) ? value : await webFinger(value);
  const actor = await federationJson(actorUri);
  const row = await persistRemoteActor(admin, actor);
  let posts = 0;
  if (fetchPosts > 0) posts = await persistRemoteActorPosts(admin, actor, fetchPosts);
  return { actor: row, posts, actorDocument: actor };
}

export const remoteMaterializationContext = { CTX, PUBLIC };
