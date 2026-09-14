import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { federationJson } from "../_shared/federation-security.ts";
import { persistRemoteActor } from "../_shared/remote-materialization.ts";

const U = Deno.env.get('SUPABASE_URL')!;
const S = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '';
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });
const now = () => new Date().toISOString();
const MAX = 50;

async function authorized(req: Request) {
  const key = req.headers.get('x-federation-worker-key') || '';
  const expected = Deno.env.get('FEDERATION_WORKER_KEY') || '';
  if (expected && key === expected) return true;
  const token = req.headers.get('x-federation-worker-token') || '';
  if (!token) return false;
  const { data } = await admin.from('federation_worker_config').select('token').eq('id', true).maybeSingle();
  return !!data?.token && token === data.token;
}

Deno.serve(async req => {
  if (req.method === 'GET') return new Response(JSON.stringify({ ok: true, service: 'testagram-federation-actor-refresh', version: '1.0' }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  if (!await authorized(req)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  try {
    const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit') || 25), 1), MAX);
    const { data: actors, error } = await admin.from('federated_actors').select('*').eq('federation_status', 'active').or(`next_refresh_at.is.null,next_refresh_at.lte.${now()}`).order('next_refresh_at', { ascending: true, nullsFirst: true }).limit(limit);
    if (error) throw error;
    let refreshed = 0, failed = 0, retired = 0;
    for (const row of actors || []) {
      const actorUrl = String(row.uri || row.actor_url || '');
      if (!/^https:\/\//i.test(actorUrl)) continue;
      try {
        const actor = await federationJson(actorUrl, { headers: { Accept: 'application/activity+json, application/ld+json, application/json' } });
        if (actor?.type === 'Tombstone' || actor?.deleted === true) {
          await admin.from('federated_actors').update({ federation_status: 'deleted', next_refresh_at: null, last_fetch_success_at: now(), updated_at: now() }).eq('id', row.id);
          retired++;
          continue;
        }
        const saved = await persistRemoteActor(admin, actor);
        await admin.from('federated_actors').update({ first_seen_at: row.first_seen_at || now(), last_fetch_success_at: now(), last_fetch_failure_at: null, refresh_failure_count: 0, next_refresh_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), federation_status: 'active', updated_at: now() }).eq('id', saved.id);
        refreshed++;
      } catch (e) {
        const failures = Number(row.refresh_failure_count || 0) + 1;
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
        const delayHours = Math.min(24, Math.max(1, Math.pow(2, Math.min(5, failures - 1))));
        await admin.from('federated_actors').update({ last_fetch_failure_at: now(), refresh_failure_count: failures, next_refresh_at: new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString(), updated_at: now() }).eq('id', row.id);
        failed++;
      }
    }
    return new Response(JSON.stringify({ ok: true, selected: actors?.length || 0, refreshed, failed, retired }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
