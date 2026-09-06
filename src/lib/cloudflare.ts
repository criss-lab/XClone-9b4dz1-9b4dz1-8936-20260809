import type { AuthUser } from '@/types/app-types';

type Row = Record<string, any>;
type Session = { access_token: string; token_type: 'bearer' };
type CloudflareUser = { id: string; email?: string; created_at?: string; user_metadata?: Record<string, any> };
type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';

const API_URL = (import.meta.env.VITE_CLOUDFLARE_API_URL || '').replace(/\/$/, '');
const RELAY_URL = (import.meta.env.VITE_CLOUDFLARE_RELAY_URL || '').replace(/\/$/, '');
const SESSION_KEY = 'tsocial.cloudflare.session';
export const cloudflareRelayUrl = RELAY_URL;
export const SHARED_BACKEND = { cloudflareApiUrl: API_URL, cloudflareRelayUrl: RELAY_URL };
export function isCloudflareRelayConfigured(): boolean { return Boolean(cloudflareRelayUrl); }
export async function cloudflareHealth(): Promise<any> { if (!cloudflareRelayUrl) throw new Error('Cloudflare relay URL is not configured'); const base = cloudflareRelayUrl.replace(/\/+$/, '').replace(/\/v1\/relay$/, ''); const response = await fetch(`${base}/health`); if (!response.ok) throw new Error(`Cloudflare relay health failed: ${response.status}`); return response.json(); }
export function buildRelayUrl(streamId: string, viewerTicket: string, hlsPath: string): string { if (!cloudflareRelayUrl) throw new Error('Cloudflare relay URL is not configured'); const url = new URL(cloudflareRelayUrl); url.searchParams.set('id', streamId); url.searchParams.set('ticket', viewerTicket); url.searchParams.set('path', hlsPath.startsWith('/') ? hlsPath : `/${hlsPath}`); return url.toString(); }
function apiUrl(path: string) { return API_URL ? `${API_URL}${path}` : path; }
function loadSession(): Session | null { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function saveSession(session: Session | null) { if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY); }
async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> { const session = loadSession(); const headers = new Headers(init.headers); if (init.body && !headers.has('Content-Type') && !(init.body instanceof Blob)) headers.set('Content-Type', 'application/json'); if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`); const response = await fetch(apiUrl(path), { ...init, headers }); const payload = await response.json().catch(() => ({})); if (!response.ok || payload?.error) throw new Error(payload?.error || `Request failed (${response.status})`); return payload as T; }
function mapUser(user: CloudflareUser): AuthUser { return { id: user.id, email: user.email || '', username: user.user_metadata?.username || user.user_metadata?.full_name || user.email?.split('@')[0] || user.id.slice(0, 8), avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture }; }
class AuthClient {
  private listeners = new Set<(event: AuthEvent, session: any) => void>();
  async getSession() { const session = loadSession(); if (!session) return { data: { session: null }, error: null }; try { const result = await request<{ user: CloudflareUser | null }>('/api/auth/session'); if (!result.user) { saveSession(null); return { data: { session: null }, error: null }; } return { data: { session: { ...session, user: result.user } }, error: null }; } catch { saveSession(null); return { data: { session: null }, error: null }; } }
  async getUser() { const { data } = await this.getSession(); return { data: { user: data.session?.user || null }, error: null }; }
  onAuthStateChange(callback: (event: AuthEvent, session: any) => void) { this.listeners.add(callback); return { data: { subscription: { unsubscribe: () => this.listeners.delete(callback) } } }; }
  private emit(event: AuthEvent, session: any) { for (const listener of this.listeners) listener(event, session); }
  async signInWithOtp({ email }: { email: string; options?: any }) { try { await request('/api/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) }); return { data: {}, error: null }; } catch (error: any) { return { data: null, error }; } }
  async verifyOtp({ email, token, password }: { email: string; token: string; type?: string; password?: string }) { try { if (!password || password.length < 8) throw new Error('Password must be at least 8 characters'); const result = await request<{ session: Session; user: CloudflareUser }>('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, token, password }) }); saveSession(result.session); const session = { ...result.session, user: result.user }; this.emit('SIGNED_IN', session); return { data: { session, user: result.user }, error: null }; } catch (error: any) { return { data: null, error }; } }
  async signInWithPassword({ email, password }: { email: string; password: string }) { try { const result = await request<{ session: Session; user: CloudflareUser }>('/api/auth/sign-in', { method: 'POST', body: JSON.stringify({ email, password }) }); saveSession(result.session); const session = { ...result.session, user: result.user }; this.emit('SIGNED_IN', session); return { data: { session, user: result.user }, error: null }; } catch (error: any) { return { data: null, error }; } }
  async updateUser(..._args: any[]) { throw new Error('Use an explicit Cloudflare profile endpoint for account updates.'); }
  async signOut() { try { await request('/api/auth/sign-out', { method: 'POST' }); } finally { saveSession(null); this.emit('SIGNED_OUT', null); } return { error: null }; }
}
class QueryBuilder implements PromiseLike<any> {
  private payload: any;
  constructor(table: string) { this.payload = { table, operation: 'select', columns: ['*'], filters: [] as any[] }; }
  select(columns = '*', ..._args: any[]) { this.payload.operation = 'select'; this.payload.columns = columns === '*' ? ['*'] : columns.split(',').map((x: string) => x.trim()); return this; }
  eq(column: string, value: any) { this.payload.filters.push({ column, op: 'eq', value }); return this; }
  neq(column: string, value: any) { this.payload.filters.push({ column, op: 'neq', value }); return this; }
  gt(column: string, value: any) { this.payload.filters.push({ column, op: 'gt', value }); return this; }
  gte(column: string, value: any) { this.payload.filters.push({ column, op: 'gte', value }); return this; }
  lt(column: string, value: any) { this.payload.filters.push({ column, op: 'lt', value }); return this; }
  lte(column: string, value: any) { this.payload.filters.push({ column, op: 'lte', value }); return this; }
  is(column: string, value: any) { this.payload.filters.push({ column, op: 'is', value }); return this; }
  in(column: string, values: any[]) { this.payload.filters.push({ column, op: 'in', value: values }); return this; }
  like(column: string, value: any) { this.payload.filters.push({ column, op: 'like', value }); return this; }
  ilike(column: string, value: any) { this.payload.filters.push({ column, op: 'ilike', value }); return this; }
  not(column: string, op: string, value: any) { this.payload.filters.push({ column, op: 'not', operator: op, value }); return this; }
  or(expression: string) { this.payload.or = expression; return this; }
  match(values: Record<string, any>) { for (const [column, value] of Object.entries(values)) this.eq(column, value); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.payload.orderColumn = column; this.payload.orderAscending = options?.ascending !== false; return this; }
  limit(value: number) { this.payload.limit = value; return this; }
  range(from: number, to: number) { this.payload.offset = from; this.payload.limit = Math.max(0, to - from + 1); return this; }
  maybeSingle() { this.payload.limit = 1; return this.then((r: any) => ({ data: r.data?.[0] || null, error: r.error })); }
  single() { this.payload.limit = 1; return this.then((r: any) => ({ data: r.data?.[0] || null, error: r.error })); }
  insert(data: Row | Row[], ..._args: any[]) { this.payload.operation = 'insert'; this.payload.data = Array.isArray(data) ? data[0] : data; return this; }
  upsert(data: Row | Row[], options?: any) { this.payload.operation = 'upsert'; this.payload.data = Array.isArray(data) ? data[0] : data; this.payload.conflictColumns = options?.onConflict?.split(',').map((x: string) => x.trim()); return this; }
  update(data: Row, ..._args: any[]) { this.payload.operation = 'update'; this.payload.data = data; return this; }
  delete() { this.payload.operation = 'delete'; return this; }
  then<TResult1 = any, TResult2 = never>(onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) { return request('/api/db', { method: 'POST', body: JSON.stringify(this.payload) }).then(onfulfilled as any, onrejected as any); }
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null) { return this.then(undefined, onrejected as any); }
}
class CloudflareClient {
  auth = new AuthClient();
  from(table: string) { return new QueryBuilder(table); }
  rpc = async (name: string, args?: any, ..._rest: any[]) => this.functions.invoke(name, { body: args ?? {} });
  functions = { invoke: async (name: string, options?: { body?: any; headers?: Record<string, string> }) => { try { return { data: await request(`/api/functions/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(options?.body ?? {}), headers: options?.headers }), error: null }; } catch (error: any) { return { data: null, error }; } } };
  channel = (..._args: any[]) => ({ on: (..._onArgs: any[]) => ({ subscribe: (..._subscribeArgs: any[]) => ({ unsubscribe: () => {} }) }) });
  removeChannel = async (..._args: any[]) => ({ error: null });
  storage: any = { from: (_bucket: string) => ({ upload: async (path: string, file: Blob, _options?: any) => { await this.mediaUpload(file, path); return { data: { path }, error: null }; }, getPublicUrl: (path: string) => ({ data: { publicUrl: this.mediaUrl(path) } }), remove: async (paths: string[]) => { await Promise.all(paths.map((p) => request('/api/media/' + p, { method: 'DELETE' }))); return { data: null, error: null }; } }) };
  async mediaUpload(file: Blob, key: string) { if (!/^users\/[^/]+\//.test(key)) throw new Error('Media keys must be user scoped'); return request('/api/media/' + key, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }); }
  mediaUrl(key: string) { return apiUrl('/api/media/' + key); }
  raw = request;
}
export const supabase: any = new CloudflareClient();
export { mapUser as mapSupabaseUser };
export async function currentAccessToken(): Promise<string | null> { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? null; }
export type User = CloudflareUser;
export type { CloudflareUser, Session };
