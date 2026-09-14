import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ── Native ActivityPub control plane ──────────────────────────────────────────
// Protocol discovery/delivery terminates on Vercel. Supabase remains the source
// of truth and async delivery queue; Cloudflare/Cloudinary remain media layers.

async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch { return null; }
}

export async function federationApi<T = any>(
  route: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const token = await getToken();
  const url = new URL('/api/federation', window.location.origin);
  url.searchParams.set('route', route);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(typeof data === 'object' && data?.error ? data.error : `Federation request failed (${response.status})`);
  return data as T;
}

export async function enableFederation(input?: {
  username?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  headerUrl?: string;
}) {
  return federationApi<{ actor: any; username: string }>('provision', 'POST', input || {});
}

export async function publishFederatedPost(payload: {
  postId?: string;
  content: string;
  visibility?: 'public' | 'unlisted' | 'followers' | 'direct';
  inReplyTo?: string;
  sensitive?: boolean;
  spoilerText?: string;
  attachments?: Array<Record<string, unknown>>;
}) {
  const token = await getToken();
  if (!token) throw new Error('You must be signed in to publish to the fediverse.');
  const { data, error } = await supabase.functions.invoke('federation-publish', {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context?.status ?? 500;
      const text = await error.context?.text().catch(() => '');
      throw new Error(`[${status}] ${text || error.message}`);
    }
    throw error;
  }
  return data;
}

export async function getNativeActor(username: string) {
  const response = await fetch(`/users/${encodeURIComponent(username)}`, { headers: { Accept: 'application/activity+json' } });
  if (!response.ok) throw new Error(`Actor lookup failed (${response.status})`);
  return response.json();
}

export async function resolveRemoteAccount(acct: string) {
  const value = acct.replace(/^@/, '');
  const at = value.lastIndexOf('@');
  if (at <= 0) throw new Error('Use the format @username@domain');
  const username = value.slice(0, at);
  const domain = value.slice(at + 1);
  const response = await fetch(`https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${username}@${domain}`)}`, {
    headers: { Accept: 'application/jrd+json, application/json' },
  });
  if (!response.ok) throw new Error(`WebFinger failed (${response.status})`);
  const document = await response.json();
  const self = document.links?.find((link: any) => link.rel === 'self' && String(link.type || '').includes('activity'));
  if (!self?.href) throw new Error('Remote account does not expose an ActivityPub actor');
  const actorResponse = await fetch(self.href, { headers: { Accept: 'application/activity+json' } });
  if (!actorResponse.ok) throw new Error(`Remote actor fetch failed (${actorResponse.status})`);
  return actorResponse.json();
}

// ── Legacy gateway compatibility ──────────────────────────────────────────────

async function relay<T = any>(
  path: string,
  method = 'GET',
  body?: unknown,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const token = await getToken();
  const cleanParams = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])) : undefined;
  const { data, error } = await supabase.functions.invoke('gateway-relay', {
    body: { path, method, body, params: cleanParams },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { msg = `[${error.context?.status ?? 500}] ${await error.context?.text() || error.message}`; } catch {}
    }
    throw new GatewayError(0, msg, path);
  }
  return data as T;
}

export class GatewayError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`Gateway error on ${path}: ${body}`);
    this.name = 'GatewayError';
  }
}

export function isGatewayAvailable(): boolean { return true; }
export function getGatewayUrl(): string { return 'supabase://gateway-relay'; }

export interface TimelineParams { limit?: number; before?: string; after?: string; }
export async function getHomeTimeline(params: TimelineParams = {}): Promise<any[]> { return relay('/timeline/home', 'GET', undefined, params as any); }
export async function getGlobalTimeline(params: TimelineParams = {}): Promise<any[]> { return relay('/timeline/global', 'GET', undefined, params as any); }
export async function getLocalTimeline(params: TimelineParams = {}): Promise<any[]> { return relay('/timeline/local', 'GET', undefined, params as any); }
export async function getFederatedTimeline(params: TimelineParams = {}): Promise<any[]> { return relay('/timeline/federated', 'GET', undefined, params as any); }
export async function getUser(acct: string): Promise<any> { return relay(`/webfinger/${encodeURIComponent(acct)}`); }
export async function webfinger(acct: string): Promise<any> { return relay(`/webfinger/${encodeURIComponent(acct)}`); }
export async function getActor(username: string): Promise<any> { return getNativeActor(username); }

export async function postStatus(payload: { content: string; mediaIds?: string[]; visibility?: 'public' | 'unlisted' | 'followers' | 'direct'; inReplyTo?: string; sensitive?: boolean; spoilerText?: string; }): Promise<any> {
  return relay('/posts', 'POST', payload);
}
export async function deletePost(postId: string): Promise<void> { return relay(`/posts/${encodeURIComponent(postId)}`, 'DELETE'); }
export async function follow(target: string): Promise<any> { return relay('/follow', 'POST', { target }); }
export async function unfollow(target: string): Promise<any> { return relay('/unfollow', 'POST', { target }); }
export async function boost(postId: string): Promise<any> { return relay('/boost', 'POST', { post_id: postId }); }
export async function unboost(postId: string): Promise<any> { return relay('/unboost', 'POST', { post_id: postId }); }
export async function favorite(postId: string): Promise<any> { return relay('/favorite', 'POST', { post_id: postId }); }
export async function unfavorite(postId: string): Promise<any> { return relay('/unfavorite', 'POST', { post_id: postId }); }
export async function reply(payload: { postId: string; content: string }): Promise<any> { return relay('/reply', 'POST', { post_id: payload.postId, content: payload.content }); }
export async function getNotifications(params: TimelineParams = {}): Promise<any[]> { return relay('/notifications', 'GET', undefined, params as any); }
export async function clearNotifications(): Promise<void> { return relay('/notifications', 'DELETE'); }
export async function search(q: string, type: 'users' | 'posts' | 'hashtags' | 'instances' = 'users'): Promise<any[]> { return relay('/search', 'GET', undefined, { q, type }); }
export async function getFollowers(acct: string, params: TimelineParams = {}): Promise<any> { return relay(`/users/${encodeURIComponent(acct)}/followers`, 'GET', undefined, params as any); }
export async function getFollowing(acct: string, params: TimelineParams = {}): Promise<any> { return relay(`/users/${encodeURIComponent(acct)}/following`, 'GET', undefined, params as any); }
export async function getInstance(): Promise<any> { return relay('/health'); }
export async function getHealth(): Promise<any> { return relay('/health'); }

export async function pollFediverseInbox(userId: string): Promise<any[]> {
  try {
    const { data } = await supabase.from('federation_inbox').select('*').eq('local_actor_id', userId).order('received_at', { ascending: false }).limit(50);
    return data ?? [];
  } catch { return []; }
}

export async function gwRelay<T = any>(path: string, method = 'GET', body?: any, params?: Record<string, any>): Promise<T> {
  return relay<T>(path, method, body, params);
}
