import { supabase } from '@/lib/supabase';
async function getToken(): Promise<string | null> { try { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? null; } catch { return null; } }
async function relay<T = any>(path: string, method = 'GET', body?: unknown, params?: Record<string, any>): Promise<T> { const token = await getToken(); const cleanParams = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])) : undefined; const { data, error } = await supabase.functions.invoke('gateway-relay', { body: { path, method, body, params: cleanParams }, headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (error) throw new GatewayError(0, error.message || 'Gateway error', path); return data as T; }
export class GatewayError extends Error { constructor(public status: number, public body: string, public path: string) { super(`Gateway error on ${path}: ${body}`); this.name = 'GatewayError'; } }
export function isGatewayAvailable(): boolean { return true; }
export function getGatewayUrl(): string { return 'cloudflare://gateway-relay'; }
export interface TimelineParams { limit?: number; before?: string; after?: string; }
export const getHomeTimeline = (p: TimelineParams = {}) => relay<any[]>('/timeline/home', 'GET', undefined, p);
export const getGlobalTimeline = (p: TimelineParams = {}) => relay<any[]>('/timeline/global', 'GET', undefined, p);
export const getLocalTimeline = (p: TimelineParams = {}) => relay<any[]>('/timeline/local', 'GET', undefined, p);
export const getFederatedTimeline = (p: TimelineParams = {}) => relay<any[]>('/timeline/federated', 'GET', undefined, p);
export const getUser = (a: string) => relay<any>(`/webfinger/${encodeURIComponent(a)}`);
export const webfinger = getUser;
export const getActor = (u: string) => relay<any>(`/users/${encodeURIComponent(u)}`);
export const postStatus = (p: any) => relay('/posts', 'POST', p);
export async function deletePost(id: string): Promise<void> { await relay(`/posts/${encodeURIComponent(id)}`, 'DELETE'); }
export const follow = (t: string) => relay('/follow', 'POST', { target: t });
export const unfollow = (t: string) => relay('/unfollow', 'POST', { target: t });
export const boost = (id: string) => relay('/boost', 'POST', { post_id: id });
export const unboost = (id: string) => relay('/unboost', 'POST', { post_id: id });
export const favorite = (id: string) => relay('/favorite', 'POST', { post_id: id });
export const unfavorite = (id: string) => relay('/unfavorite', 'POST', { post_id: id });
export const reply = (p: any) => relay('/reply', 'POST', { post_id: p.postId, content: p.content });
export const getNotifications = (p: TimelineParams = {}) => relay<any[]>('/notifications', 'GET', undefined, p);
export async function clearNotifications(): Promise<void> { await relay('/notifications', 'DELETE'); }
export const search = (q: string, type: any = 'users') => relay<any[]>('/search', 'GET', undefined, { q, type });
export const getFollowers = (a: string, p: TimelineParams = {}) => relay<any>(`/users/${encodeURIComponent(a)}/followers`, 'GET', undefined, p);
export const getFollowing = (a: string, p: TimelineParams = {}) => relay<any>(`/users/${encodeURIComponent(a)}/following`, 'GET', undefined, p);
export const getInstance = () => relay<any>('/health');
export const getHealth = getInstance;
export async function pollFediverseInbox(userId: string): Promise<any[]> { try { const r = await getNotifications({ limit: 50 }); return Array.isArray(r) ? r : []; } catch { try { const { data } = await supabase.from('activitypub_inbox').select('*').eq('local_user_id', userId).order('created_at', { ascending: false }).limit(50); return data ?? []; } catch { return []; } } }
export function gwRelay<T = any>(path: string, method = 'GET', body?: any, params?: Record<string, any>): Promise<T> { return relay<T>(path, method, body, params); }
