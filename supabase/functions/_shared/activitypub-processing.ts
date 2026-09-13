import { actorKeyMatches, federationFetch, federationJson } from './federation-security.ts';
import { persistRemoteActor } from './remote-materialization.ts';

const AP_CONTEXT = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];
const now = () => new Date().toISOString();
const text = (v: unknown) => typeof v === 'string' ? v : '';
const uri = (v: unknown) => typeof v === 'string' ? v : v && typeof v === 'object' ? text((v as Record<string, unknown>).id) : '';
const uris = (v: unknown) => Array.isArray(v) ? v.map(uri).filter(Boolean) : [uri(v)].filter(Boolean);

async function localActor(admin: any, actorUri: string) {
  const { data, error } = await admin.from('federated_actors').select('*').or(`uri.eq.${encodeURIComponent(actorUri)},actor_url.eq.${encodeURIComponent(actorUri)}`).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function remoteActor(admin: any, actorUri: string) {
  const remote = await federationJson(actorUri);
  if (!actorKeyMatches(remote, actorUri)) throw new Error('remote actor identity or public key is invalid');
  const row = await persistRemoteActor(admin, remote);
  await admin.from('federated_actors').update({ last_fetch_success_at: now(), refresh_failure_count: 0, next_refresh_at: new Date(Date.now() + 21600000).toISOString(), federation_status: 'active' }).eq('id', row.id);
  return remote;
}

async function saveObject(admin: any, actorUri: string, object: any, instanceId: any) {
  const id = uri(object?.id);
  if (!id || !/^https:\/\//i.test(id)) throw new Error('remote object must have an HTTPS id');
  const attributed = uri(object?.attributedTo) || actorUri;
  if (attributed !== actorUri) throw new Error('signed actor does not own the object');
  const type = text(object?.type) || 'Object';
  if (!['Note', 'Article', 'Question', 'Video', 'Image'].includes(type)) return false;
  const { data: existing, error: existingError } = await admin.from('federated_objects').select('actor_uri').eq('uri', id).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.actor_uri && existing.actor_uri !== actorUri) throw new Error('object ownership mismatch');
  const poll = type === 'Question' ? { oneOf: Array.isArray(object?.oneOf) ? object.oneOf : null, anyOf: Array.isArray(object?.anyOf) ? object.anyOf : null, closed: object?.closed ?? null } : null;
  const { error } = await admin.from('federated_objects').upsert({ uri: id, object_type: type, actor_uri: actorUri, instance_id: instanceId, url: text(object?.url) || id, content: text(object?.content) || text(object?.name) || null, summary: text(object?.summary) || null, content_warning: text(object?.summary) || null, published_at: object?.published ? new Date(object.published).toISOString() : null, updated_at: object?.updated ? new Date(object.updated).toISOString() : now(), sensitive: Boolean(object?.sensitive), in_reply_to_uri: uri(object?.inReplyTo) || null, quote_uri: uri(object?.quote) || uri(object?.quoteUrl) || uri(object?.quoteUri) || null, attachments: Array.isArray(object?.attachment) ? object.attachment : [], tags: Array.isArray(object?.tag) ? object.tag : [], poll, raw_object: object, tombstone: false, deleted_at: null }, { onConflict: 'uri' });
  if (error) throw error;
  return true;
}

async function ancestors(admin: any, actorUri: string, parent: string, instanceId: any, depth = 0) {
  if (!parent || depth > 8 || !/^https:\/\//i.test(parent)) return;
  const { data, error } = await admin.from('federated_objects').select('uri,in_reply_to_uri').eq('uri', parent).maybeSingle();
  if (error) throw error;
  if (data?.uri) { if (data.in_reply_to_uri) await ancestors(admin, actorUri, data.in_reply_to_uri, instanceId, depth + 1); return; }
  const object = await federationJson(parent);
  if (uri(object?.attributedTo) && uri(object.attributedTo) !== actorUri) throw new Error('reply ancestor actor mismatch');
  if (await saveObject(admin, actorUri, object, instanceId) && uri(object?.inReplyTo)) await ancestors(admin, actorUri, uri(object.inReplyTo), instanceId, depth + 1);
}

async function count(admin: any, objectUri: string, column: string, delta: number) {
  const { data, error } = await admin.from('federated_objects').select(`id,${column}`).eq('uri', objectUri).maybeSingle();
  if (error) throw error;
  if (!data?.id) return;
  const { error: updateError } = await admin.from('federated_objects').update({ [column]: Math.max(0, Number(data[column] || 0) + delta), updated_at: now() }).eq('id', data.id);
  if (updateError) throw updateError;
}

async function sendSigned(local: any, remoteActorUri: string, activity: any) {
  const remote = await federationJson(remoteActorUri);
  const inbox = remote?.endpoints?.sharedInbox || remote?.inbox;
  if (typeof inbox !== 'string') throw new Error('remote actor has no inbox');
  const body = JSON.stringify(activity), u = new URL(inbox), date = new Date().toUTCString();
  const digest = `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))))}`;
  const key = await crypto.subtle.importKey('jwk', local.private_key_jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const canonical = `(request-target): post ${u.pathname}${u.search}\nhost: ${u.host}\ndate: ${date}\ndigest: ${digest}`;
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(canonical)))));
  const response = await federationFetch(inbox, { method: 'POST', body, headers: { Date: date, Digest: digest, Host: u.host, Accept: 'application/activity+json, application/ld+json', 'Content-Type': 'application/activity+json', Signature: `keyId=\"${local.uri || local.actor_url}#main-key\",algorithm=\"rsa-sha256\",headers=\"(request-target) host date digest\",signature=\"${signature}\"`, 'User-Agent': 'Testagram-Federation/6.0' } });
  if (!response.ok) throw new Error(`remote inbox returned HTTP ${response.status}`);
}

async function correlateFollow(admin: any, followId: string, remoteActorUri: string) {
  const { data, error } = await admin.from('federated_activities').select('raw_activity,activity_type,actor_uri,object_uri').eq('uri', followId).maybeSingle();
  if (error) throw error;
  if (!data || data.activity_type !== 'Follow' || data.actor_uri !== remoteActorUri) throw new Error('invalid Follow correlation');
  return data;
}

async function handleFollow(admin: any, activity: any, actorUri: string) {
  const target = uri(activity.object) || uri(activity.target);
  if (!target) throw new Error('Follow target is required');
  const local = await localActor(admin, target);
  if (!local) throw new Error('Follow target is not local');
  const { data: blocked } = await admin.from('federated_relationships').select('id').eq('local_user_id', local.user_id).eq('remote_actor_uri', actorUri).eq('relationship', 'blocked').in('state', ['active', 'accepted']).maybeSingle();
  const accepted = !blocked;
  const { error } = await admin.from('federated_relationships').upsert({ local_user_id: local.user_id, remote_actor_uri: actorUri, relationship: 'follower', state: accepted ? 'active' : 'rejected', updated_at: now() }, { onConflict: 'local_user_id,remote_actor_uri,relationship' });
  if (error) throw error;
  const responseActivity = { '@context': AP_CONTEXT, id: `${local.uri || local.actor_url}/activities/${crypto.randomUUID()}`, type: accepted ? 'Accept' : 'Reject', actor: local.uri || local.actor_url, object: activity };
  await sendSigned(local, actorUri, responseActivity);
}

async function handleAcceptReject(admin: any, activity: any, actorUri: string) {
  const followId = uri(activity.object);
  if (!followId) throw new Error('Accept/Reject missing original Follow');
  const original = await correlateFollow(admin, followId, actorUri);
  const local = await localActor(admin, original.actor_uri);
  if (!local) throw new Error('original Follow actor is not local');
  if (uri((original.raw_activity as any).object) !== actorUri) throw new Error('Accept/Reject actor does not match Follow target');
  const { error } = await admin.from('federated_relationships').upsert({ local_user_id: local.user_id, remote_actor_uri: actorUri, relationship: 'following', state: activity.type === 'Accept' ? 'active' : 'rejected', updated_at: now() }, { onConflict: 'local_user_id,remote_actor_uri,relationship' });
  if (error) throw error;
}

async function handleBlock(admin: any, activity: any, actorUri: string) {
  const local = await localActor(admin, uri(activity.object));
  if (!local) throw new Error('Block target is not local');
  const { error } = await admin.from('federated_relationships').upsert({ local_user_id: local.user_id, remote_actor_uri: actorUri, relationship: 'blocked', state: 'active', updated_at: now() }, { onConflict: 'local_user_id,remote_actor_uri,relationship' });
  if (error) throw error;
}

async function handleFlag(admin: any, activity: any, actorUri: string) {
  const objects = uris(activity.object);
  const targetActor = objects.find((value) => value.startsWith('https://') && !value.includes('/objects/') && !value.includes('/statuses/')) || null;
  const { error } = await admin.from('federation_reports').upsert({ activity_uri: text(activity.id), reporter_actor_uri: actorUri, target_actor_uri: targetActor, target_object_uris: objects, content: text(activity.content) || null, raw_activity: activity, status: 'received', updated_at: now() }, { onConflict: 'activity_uri' });
  if (error) throw error;
}

async function handleMove(admin: any, activity: any, actorUri: string) {
  const target = uri(activity.target);
  if (!target) throw new Error('Move target is required');
  const newActor = await federationJson(target);
  const aliases = Array.isArray(newActor?.alsoKnownAs) ? newActor.alsoKnownAs : [];
  if (!aliases.includes(actorUri)) throw new Error('Move target does not advertise alsoKnownAs for source actor');
  const { error } = await admin.from('federated_actors').update({ moved_to_uri: target, updated_at: now() }).eq('uri', actorUri);
  if (error) throw error;
  await admin.from('federated_actors').upsert({ uri: target, moved_to_uri: null, also_known_as: aliases, raw_actor: newActor, updated_at: now() }, { onConflict: 'uri' });
}

async function handleFeatured(admin: any, activity: any, actorUri: string, active: boolean) {
  const objectUri = uri(activity.object);
  if (!objectUri) throw new Error('featured activity requires an object');
  const { error } = await admin.from('federation_featured_items').upsert({ actor_uri: actorUri, object_uri: objectUri, activity_uri: text(activity.id), active, updated_at: now() }, { onConflict: 'actor_uri,object_uri' });
  if (error) throw error;
}

async function handleQuote(admin: any, activity: any, actorUri: string) {
  const type = text(activity.type);
  if (type === 'QuoteRequest') {
    const quoted = uri(activity.object) || uri(activity.target) || uri((activity as any).quote);
    if (!quoted) throw new Error('QuoteRequest missing quoted object');
    const object = await federationJson(quoted), quotedActor = uri(object?.attributedTo);
    if (!quotedActor) throw new Error('Quoted object has no author');
    const { error } = await admin.from('federation_quote_authorizations').upsert({ request_uri: text(activity.id), quote_uri: text(activity.id), quoted_object_uri: quoted, requester_actor_uri: actorUri, quoted_actor_uri: quotedActor, state: 'pending', raw_request: activity, updated_at: now() }, { onConflict: 'request_uri' });
    if (error) throw error;
    return;
  }
  const requestId = uri(activity.object);
  const { data: request } = await admin.from('federation_quote_authorizations').select('*').eq('request_uri', requestId).maybeSingle();
  if (!request) return;
  const state = type === 'Accept' ? 'accepted' : type === 'Reject' ? 'rejected' : 'revoked';
  const { error } = await admin.from('federation_quote_authorizations').update({ authorization_uri: text(activity.id), state, raw_authorization: activity, updated_at: now() }).eq('request_uri', requestId);
  if (error) throw error;
}

export async function processActivity(admin: any, activity: any, actorUri: string) {
  const type = text(activity.type), objectUri = uri(activity.object);
  if (!activity.id) throw new Error('activity id is required');
  if (type === 'Follow') return handleFollow(admin, activity, actorUri);
  if (type === 'Accept' || type === 'Reject') {
    const requestId = uri(activity.object);
    const { data: quoteRequest } = await admin.from('federation_quote_authorizations').select('id').eq('request_uri', requestId).maybeSingle();
    if (quoteRequest) return handleQuote(admin, activity, actorUri);
    return handleAcceptReject(admin, activity, actorUri);
  }
  if (type === 'Block') return handleBlock(admin, activity, actorUri);
  if (type === 'Flag') return handleFlag(admin, activity, actorUri);
  if (type === 'Move') return handleMove(admin, activity, actorUri);
  if (type === 'Add') return handleFeatured(admin, activity, actorUri, true);
  if (type === 'Remove') return handleFeatured(admin, activity, actorUri, false);
  if (type === 'QuoteRequest' || type === 'QuoteAuthorization') return handleQuote(admin, activity, actorUri);
  if (type === 'Create' || type === 'Update') {
    const object = typeof activity.object === 'object' && activity.object ? activity.object : null;
    if (!object) throw new Error(`${type} object is invalid`);
    const remote = await remoteActor(admin, actorUri);
    if (['Person', 'Service', 'Organization'].includes(text(object.type))) {
      const { error } = await admin.from('federated_actors').upsert({ uri: actorUri, preferred_username: text(object.preferredUsername), display_name: text(object.name), summary: text(object.summary), avatar_url: text(object.icon?.url), inbox_url: text(object.inbox), shared_inbox_url: text(object.endpoints?.sharedInbox), outbox_url: text(object.outbox), followers_url: text(object.followers), following_url: text(object.following), public_key_id: text(object.publicKey?.id), public_key_pem: text(object.publicKey?.publicKeyPem), discoverable: object.discoverable !== false, locked: Boolean(object.manuallyApprovesFollowers), raw_actor: object, updated_at: now() }, { onConflict: 'uri' });
      if (error) throw error;
      return;
    }
    if (await saveObject(admin, actorUri, object, remote.instance_id) && uri(object.inReplyTo)) await ancestors(admin, actorUri, uri(object.inReplyTo), remote.instance_id);
    return;
  }
  if (type === 'Like' || type === 'Announce') {
    if (!objectUri || !/^https:\/\//i.test(objectUri)) throw new Error('interaction target must be HTTPS');
    const { data: duplicate } = await admin.from('federated_interactions').select('activity_uri').eq('activity_uri', activity.id).maybeSingle();
    if (duplicate) return;
    const { error } = await admin.from('federated_interactions').insert({ activity_uri: activity.id, activity_type: type, actor_uri: actorUri, object_uri: objectUri, active: true, raw_activity: activity, updated_at: now() });
    if (error) throw error;
    await count(admin, objectUri, type === 'Like' ? 'like_count' : 'announce_count', 1);
    return;
  }
  if (type === 'Undo') {
    if (!objectUri) throw new Error('Undo missing referenced activity');
    const { data: original, error } = await admin.from('federated_activities').select('activity_type,actor_uri,raw_activity').eq('uri', objectUri).maybeSingle();
    if (error) throw error;
    if (!original || original.actor_uri !== actorUri) throw new Error('invalid Undo correlation');
    if (original.activity_type === 'Follow' || original.activity_type === 'Block') {
      const local = await localActor(admin, uri((original.raw_activity as any).object));
      if (!local) throw new Error('referenced local actor was not found');
      const relationship = original.activity_type === 'Follow' ? 'follower' : 'blocked';
      const { error: e } = await admin.from('federated_relationships').update({ state: 'removed', updated_at: now() }).eq('local_user_id', local.user_id).eq('remote_actor_uri', actorUri).eq('relationship', relationship);
      if (e) throw e;
      return;
    }
    if (original.activity_type === 'Like' || original.activity_type === 'Announce') {
      const { data: prior } = await admin.from('federated_interactions').select('object_uri,active').eq('activity_uri', objectUri).maybeSingle();
      if (prior?.active) await count(admin, prior.object_uri, original.activity_type === 'Like' ? 'like_count' : 'announce_count', -1);
      const { error: e } = await admin.from('federated_interactions').update({ active: false, updated_at: now() }).eq('activity_uri', objectUri);
      if (e) throw e;
      return;
    }
    throw new Error(`Undo type is unsupported: ${original.activity_type}`);
  }
  if (type === 'Delete') {
    if (!objectUri) throw new Error('Delete missing object');
    const { data, error } = await admin.from('federated_objects').select('actor_uri').eq('uri', objectUri).maybeSingle();
    if (error) throw error;
    if (!data) return;
    if (data.actor_uri !== actorUri) throw new Error('signed actor does not own deleted object');
    const { error: e } = await admin.from('federated_objects').update({ tombstone: true, deleted_at: now(), raw_object: { id: objectUri, type: 'Tombstone', formerType: 'Note' }, updated_at: now() }).eq('uri', objectUri);
    if (e) throw e;
    return;
  }
  throw new Error(`unsupported ActivityPub type: ${type}`);
}
