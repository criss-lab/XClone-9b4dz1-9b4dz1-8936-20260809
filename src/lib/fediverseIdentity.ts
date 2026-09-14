/** Shared canonical identity contract for every Testagram Fediverse surface. */

export function firstHttp(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim().replace(/#\/$/, '');
  }
  return '';
}

export function canonicalObjectUrl(value: any): string {
  const raw = value?.raw_object ?? value?.object ?? value?.activity ?? {};
  return firstHttp(value?.object_url, value?.canonical_url, value?.uri, value?.url, raw?.id, raw?.url, value?.object_id);
}

export function canonicalObjectKey(value: any): string {
  return canonicalObjectUrl(value) || String(value?.federated_object_id ?? value?._canonical_federated_object_id ?? value?.id ?? '').trim();
}

export function federatedObjectCandidates(value: any): string[] {
  const raw = value?.raw_object ?? value?.object ?? value?.activity ?? {};
  return [...new Set([value?.object_url, value?.canonical_url, value?.uri, value?.url, raw?.id, raw?.url, value?.federated_object_id, value?._canonical_federated_object_id, value?.id].filter(v => (typeof v === 'string' || typeof v === 'number') && String(v).trim()).map(v => String(v).trim().replace(/\/+$/, '')))];
}

export function sameFederatedObject(a: any, b: any): boolean {
  const right = new Set(federatedObjectCandidates(b));
  return federatedObjectCandidates(a).some(candidate => right.has(candidate));
}

export function normalizedRemoteActor(value: any): any {
  const candidates = [value?.remote_accounts, value?.remote_account, value?.actor, value?.account, value?.author, value?.raw_object?.attributedTo, value].filter(Boolean);
  return Object.assign({}, ...candidates.reverse(), ...candidates);
}

export function actorUrl(value: any): string {
  const actor = normalizedRemoteActor(value);
  return firstHttp(actor?.url, actor?.id, actor?.actor_url, value?.actor_url, value?.actor_uri);
}

export function actorHandle(value: any): string {
  const actor = normalizedRemoteActor(value);
  const username = String(actor?.preferredUsername ?? actor?.username ?? actor?.acct ?? value?.actor_username ?? value?.username ?? '').replace(/^@/, '').trim();
  if (username.includes('@')) return username;
  const url = actorUrl(value);
  try { return username && url ? `${username}@${new URL(url).hostname}` : username || (url ? new URL(url).hostname : ''); } catch { return username; }
}

export function normalizeFederatedPost(value: any): any {
  if (!value) return null;
  const raw = value.raw_object ?? value.object ?? value.activity ?? {};
  const actor = normalizedRemoteActor(value);
  const objectUrl = canonicalObjectUrl(value);
  const remoteActorUrl = actorUrl(value);
  return {
    ...raw,
    ...value,
    id: objectUrl || canonicalObjectKey(value),
    object_url: objectUrl || value.object_url,
    url: objectUrl || value.url,
    uri: objectUrl || value.uri,
    actor: { ...actor, id: remoteActorUrl || actor.id, url: remoteActorUrl || actor.url, preferredUsername: actor.preferredUsername ?? actor.username ?? value.actor_username, name: actor.name ?? actor.display_name ?? value.actor_name },
    content: value.content ?? raw.content ?? value.text ?? raw.text ?? '',
    created_at: value.created_at ?? value.published_at ?? raw.published ?? raw.created_at ?? '',
    media_attachments: value.media_attachments ?? raw.media_attachments ?? value.attachments ?? [],
    _is_federated: true,
  };
}

export function internalFediversePostPath(value: any): string {
  const key = canonicalObjectKey(value);
  return key ? `/fediverse/post?url=${encodeURIComponent(key)}` : '/fediverse';
}

export function internalFediverseProfilePath(value: any): string {
  const target = actorUrl(value) || actorHandle(value);
  return target ? `/fediverse/profile?actor=${encodeURIComponent(target)}` : '/fediverse';
}

export function isFederatedObject(value: any): boolean {
  return Boolean(value?._is_federated || value?._canonical_federated_object_id || value?.federated_object_id || value?.actor_uri || value?.remote_accounts || value?.remote_account);
}

export function dedupeFederatedObjects<T>(items: T[], keyOf: (item: T) => any = value => value): T[] {
  const seen = new Set<string>();
  return items.filter(item => { const key = canonicalObjectKey(keyOf(item)); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}
