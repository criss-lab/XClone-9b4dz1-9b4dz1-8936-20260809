export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CACHE: KVNamespace;
  APP_ORIGIN: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  SESSION_TTL_DAYS?: string;
}

type Json = Record<string, unknown>;

const TABLES = new Set([
  'users', 'profiles', 'posts', 'notifications', 'fcm_tokens', 'media_objects',
  'activitypub_keys', 'likes', 'reposts', 'follows', 'bookmarks', 'comments',
  'communities', 'community_members', 'hashtags', 'trending_topics', 'spaces',
  'space_members', 'polls', 'poll_options', 'poll_votes', 'products', 'orders',
  'transactions', 'wallets', 'user_wallets', 'withdrawals', 'subscriptions',
  'verification_requests', 'reports', 'blocked_users', 'scheduled_posts',
]);

const WRITE_PROTECTED = new Set(['users', 'auth_sessions', 'auth_otps']);

function cors(env: Env) {
  return {
    'Access-Control-Allow-Origin': env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Vary': 'Origin',
  };
}

function json(env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env) },
  });
}

function now() { return new Date().toISOString(); }

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function passwordHash(password: string, saltHex: string) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function bearer(request: Request) {
  const value = request.headers.get('Authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

async function currentUser(request: Request, env: Env) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`
    SELECT u.id, u.email, u.username, u.avatar_url, u.email_verified
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
    LIMIT 1
  `).bind(tokenHash, now()).first<Json>();
}

async function sendOtpEmail(env: Env, email: string, code: string) {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) {
    console.log(`[Cloudflare auth] OTP for ${email}: ${code}`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: [email],
      subject: 'Your T Social verification code',
      html: `<p>Your T Social verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
    }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}

async function authRoute(request: Request, env: Env, url: URL) {
  const path = url.pathname;
  const body = request.method === 'POST' ? await request.json<Json>() : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (path === '/api/auth/send-otp' && request.method === 'POST') {
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(env, { error: 'Valid email is required' }, 400);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const id = crypto.randomUUID();
    await env.DB.prepare('UPDATE auth_otps SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').bind(now(), email).run();
    await env.DB.prepare('INSERT INTO auth_otps (id,email,code_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
      .bind(id, email, await sha256(code), new Date(Date.now() + 10 * 60_000).toISOString(), now()).run();
    await sendOtpEmail(env, email, code);
    return json(env, { ok: true });
  }

  if (path === '/api/auth/verify-otp' && request.method === 'POST') {
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !/^\d{6}$/.test(token) || password.length < 8) return json(env, { error: 'Email, 6-digit token and password (8+ chars) are required' }, 400);
    const otp = await env.DB.prepare('SELECT * FROM auth_otps WHERE email = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1').bind(email, now()).first<Json>();
    if (!otp || otp.code_hash !== await sha256(token)) return json(env, { error: 'Invalid or expired verification code' }, 401);
    await env.DB.prepare('UPDATE auth_otps SET consumed_at = ? WHERE id = ?').bind(now(), otp.id).run();
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<Json>();
    const userId = (existing?.id as string | undefined) || crypto.randomUUID();
    const username = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30) || `user_${userId.slice(0, 8)}`;
    const salt = randomHex(16);
    const hash = await passwordHash(password, salt);
    if (existing) {
      await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, email_verified = 1, username = ?, updated_at = ? WHERE id = ?')
        .bind(hash, salt, username, now(), userId).run();
    } else {
      await env.DB.prepare('INSERT INTO users (id,email,username,password_hash,password_salt,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(userId, email, username, hash, salt, 1, now(), now()).run();
      await env.DB.prepare('INSERT INTO profiles (id,username,created_at) VALUES (?,?,?)').bind(userId, username, now()).run();
    }
    return issueSession(env, userId);
  }

  if (path === '/api/auth/sign-in' && request.method === 'POST') {
    const password = typeof body.password === 'string' ? body.password : '';
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').bind(email).first<Json>();
    if (!user?.password_hash || !user.password_salt) return json(env, { error: 'Invalid credentials' }, 401);
    if (await passwordHash(password, user.password_salt as string) !== user.password_hash) return json(env, { error: 'Invalid credentials' }, 401);
    return issueSession(env, user.id as string);
  }

  if (path === '/api/auth/session' && request.method === 'GET') {
    const user = await currentUser(request, env);
    return json(env, { user: user ? normalizeUser(user) : null });
  }

  if (path === '/api/auth/sign-out' && request.method === 'POST') {
    const token = bearer(request);
    if (token) await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?').bind(now(), await sha256(token)).run();
    return json(env, { ok: true });
  }
  return null;
}

function normalizeUser(user: Json) {
  return {
    id: user.id,
    email: user.email,
    user_metadata: { username: user.username, avatar_url: user.avatar_url },
  };
}

async function issueSession(env: Env, userId: string) {
  const raw = randomHex(32);
  const ttl = Math.max(1, Number(env.SESSION_TTL_DAYS || 30));
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), userId, await sha256(raw), new Date(Date.now() + ttl * 86_400_000).toISOString(), now()).run();
  const user = await env.DB.prepare('SELECT id,email,username,avatar_url,email_verified FROM users WHERE id = ?').bind(userId).first<Json>();
  return json(env, { session: { access_token: raw, token_type: 'bearer' }, user: normalizeUser(user!) });
}

function identifier(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null;
}

async function dbRoute(request: Request, env: Env) {
  const user = await currentUser(request, env);
  if (!user) return json(env, { error: 'Authentication required' }, 401);
  const body = await request.json<Json>();
  const table = identifier(body.table);
  const operation = body.operation;
  if (!table || !TABLES.has(table)) return json(env, { error: 'Unsupported table' }, 400);
  if (WRITE_PROTECTED.has(table)) return json(env, { error: 'Protected table' }, 403);

  const columns = Array.isArray(body.columns) ? body.columns.map(identifier).filter(Boolean) as string[] : ['*'];
  const filters = Array.isArray(body.filters) ? body.filters as Array<{ column: string; op: string; value: unknown }> : [];
  const where: string[] = [];
  const params: unknown[] = [];
  for (const filter of filters) {
    const col = identifier(filter.column);
    if (!col || !['eq','neq','gt','gte','lt','lte','is','in'].includes(filter.op)) return json(env, { error: 'Invalid filter' }, 400);
    if (filter.op === 'in') {
      if (!Array.isArray(filter.value) || filter.value.length === 0) return json(env, { error: 'Invalid in filter' }, 400);
      where.push(`\"${col}\" IN (${filter.value.map(() => '?').join(',')})`); params.push(...filter.value);
    } else if (filter.op === 'is') {
      where.push(`\"${col}\" IS ${filter.value === null ? 'NULL' : 'NOT NULL'}`);
    } else {
      const ops: Record<string,string> = { eq:'=', neq:'<>', gt:'>', gte:'>=', lt:'<', lte:'<=' };
      where.push(`\"${col}\" ${ops[filter.op]} ?`); params.push(filter.value);
    }
  }

  if (operation === 'select') {
    const order = identifier(body.orderColumn);
    let sql = `SELECT ${columns.map((c) => c === '*' ? '*' : `\"${c}\"`).join(',')} FROM \"${table}\"`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    if (order) sql += ` ORDER BY \"${order}\" ${body.orderAscending === false ? 'DESC' : 'ASC'}`;
    const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit as number, 1), 100) : 100;
    const offset = Number.isInteger(body.offset) ? Math.max(body.offset as number, 0) : 0;
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    const result = await env.DB.prepare(sql).bind(...params).all<Json>();
    return json(env, { data: result.results || [], error: null });
  }

  const data = (body.data && typeof body.data === 'object') ? body.data as Json : {};
  const safeData = Object.entries(data).filter(([k]) => identifier(k));
  if ('user_id' in data) data.user_id = user.id;

  if (operation === 'insert' || operation === 'upsert') {
    if (!safeData.length) return json(env, { error: 'No data' }, 400);
    const names = safeData.map(([k]) => `\"${k}\"`);
    const values = safeData.map(([,v]) => v);
    const placeholders = names.map(() => '?').join(',');
    const conflict = operation === 'upsert' && Array.isArray(body.conflictColumns) ? body.conflictColumns.map(identifier).filter(Boolean) as string[] : [];
    let sql = `INSERT INTO \"${table}\" (${names.join(',')}) VALUES (${placeholders})`;
    if (conflict.length) sql += ` ON CONFLICT (${conflict.map((c) => `\"${c}\"`).join(',')}) DO UPDATE SET ${safeData.map(([k]) => `\"${k}\"=excluded.\"${k}\"`).join(',')}`;
    sql += ' RETURNING *';
    const result = await env.DB.prepare(sql).bind(...values).first<Json>();
    return json(env, { data: result ? [result] : [], error: null });
  }

  if (operation === 'update') {
    if (!safeData.length || !where.length) return json(env, { error: 'Update requires filters' }, 400);
    const setParams = safeData.map(([,v]) => v);
    const sql = `UPDATE \"${table}\" SET ${safeData.map(([k]) => `\"${k}\" = ?`).join(',')} WHERE ${where.join(' AND ')} RETURNING *`;
    const result = await env.DB.prepare(sql).bind(...setParams, ...params).all<Json>();
    return json(env, { data: result.results || [], error: null });
  }

  if (operation === 'delete') {
    if (!where.length) return json(env, { error: 'Delete requires filters' }, 400);
    const result = await env.DB.prepare(`DELETE FROM \"${table}\" WHERE ${where.join(' AND ')}`).bind(...params).run();
    return json(env, { data: [], error: null, count: result.meta?.changes ?? 0 });
  }

  return json(env, { error: 'Unsupported operation' }, 400);
}

async function mediaRoute(request: Request, env: Env, url: URL) {
  const user = await currentUser(request, env);
  if (!user) return json(env, { error: 'Authentication required' }, 401);
  const path = url.pathname.replace(/^\/api\/media\/?/, '');
  if (!path) return json(env, { error: 'Object key required' }, 400);
  const key = path.replace(/\.\./g, '').replace(/^\/+/, '');
  if (!key.startsWith(`users/${user.id}/`)) return json(env, { error: 'Forbidden object key' }, 403);

  if (request.method === 'GET') {
    const object = await env.MEDIA.get(key);
    if (!object) return json(env, { error: 'Not found' }, 404);
    const headers = new Headers(cors(env));
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(object.body, { headers });
  }

  if (request.method === 'PUT') {
    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
    const object = await env.MEDIA.put(key, request.body, { httpMetadata: { contentType } });
    await env.DB.prepare('INSERT OR REPLACE INTO media_objects (id,owner_id,object_key,content_type,byte_size,created_at) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), user.id, key, contentType, object.size, now()).run();
    return json(env, { data: { key, size: object.size } }, 201);
  }

  if (request.method === 'DELETE') {
    await env.MEDIA.delete(key);
    await env.DB.prepare('DELETE FROM media_objects WHERE object_key = ? AND owner_id = ?').bind(key, user.id).run();
    return json(env, { ok: true });
  }
  return json(env, { error: 'Method not allowed' }, 405);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    const url = new URL(request.url);
    try {
      const auth = await authRoute(request, env, url);
      if (auth) return auth;
      if (url.pathname.startsWith('/api/media/')) return mediaRoute(request, env, url);
      if (url.pathname === '/api/db') return dbRoute(request, env);
      if (url.pathname === '/health') return json(env, { ok: true, service: 'tsocial-api', timestamp: now() });
      return json(env, { error: 'Not found' }, 404);
    } catch (error) {
      console.error(error);
      return json(env, { error: 'Internal server error' }, 500);
    }
  },
};
