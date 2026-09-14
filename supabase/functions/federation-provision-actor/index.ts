import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const ORIGIN = Deno.env.get("FEDERATION_ORIGIN") || "https://federation.testagram.site";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
function toBase64(bytes: ArrayBuffer | Uint8Array) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function pem(label: string, bytes: ArrayBuffer | Uint8Array) { const base64 = toBase64(bytes).match(/.{1,64}/g)?.join("\n") || ""; return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----`; }
async function authenticatedUser(req: Request) { const authorization = req.headers.get("Authorization") || ""; if (!authorization.startsWith("Bearer ")) return null; const token = authorization.slice("Bearer ".length); const { data, error } = await admin.auth.getUser(token); if (error || !data.user) return null; return data.user; }

async function createOrRepairActor(profile: any) {
  const actorUrl = `${ORIGIN}/users/${encodeURIComponent(profile.username)}`;
  const { data: existing, error: existingError } = await admin.from("federation_actors").select("id,user_id,username,actor_url,inbox_url,public_key_pem,private_key_jwk").eq("user_id", profile.id).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.private_key_jwk && existing?.public_key_pem && existing.actor_url === actorUrl && existing.username === profile.username) return { created: false, repaired: false, actor: { id: existing.id, user_id: existing.user_id, username: existing.username, actor_url: existing.actor_url, inbox_url: existing.inbox_url, public_key_pem: existing.public_key_pem } };
  const keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicSpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicPem = pem("PUBLIC KEY", publicSpki);
  const row = { user_id: profile.id, username: profile.username, actor_url: actorUrl, inbox_url: `${actorUrl}/inbox`, public_key_pem: publicPem, private_key_jwk: privateJwk, updated_at: new Date().toISOString() };
  const { data: actor, error } = await admin.from("federation_actors").upsert(row, { onConflict: "user_id", ignoreDuplicates: false }).select("id,user_id,username,actor_url,inbox_url,public_key_pem").single();
  if (error) throw error;
  return { created: !existing, repaired: Boolean(existing), actor };
}

async function reconcileAllProfiles() {
  const { data: profiles, error } = await admin.from("profiles").select("id,username").order("created_at", { ascending: true });
  if (error) throw error;
  const results = [];
  for (const profile of profiles || []) {
    if (!profile?.id || !profile?.username) continue;
    try {
      const result = await createOrRepairActor(profile);
      await admin.from("federation_actor_provisioning_queue").upsert({ user_id: profile.id, reason: "reconciled", attempts: 0, last_error: null, processed_at: new Date().toISOString() }, { onConflict: "user_id" });
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "actor provisioning failed";
      await admin.from("federation_actor_provisioning_queue").upsert({ user_id: profile.id, reason: "provisioning_failed", attempts: 1, last_error: message, processed_at: null }, { onConflict: "user_id" });
      results.push({ created: false, repaired: false, user_id: profile.id, username: profile.username, error: message });
    }
  }
  const complete = results.filter((item: any) => item.actor && item.actor.public_key_pem).length;
  const failed = results.filter((item: any) => item.error).length;
  return { scanned: profiles?.length || 0, complete, failed, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const user = await authenticatedUser(req);
    if (!user) return json({ error: "Authentication required" }, 401);
    const result = await reconcileAllProfiles();
    const own = result.results.find((item: any) => item.actor?.user_id === user.id || item.user_id === user.id);
    return json({ ok: result.failed === 0, protocol: "activitypub", federation_origin: ORIGIN, authenticated_user_id: user.id, own, ...result });
  } catch (error) {
    console.error("federation-provision-actor", error);
    return json({ error: error instanceof Error ? error.message : "Federation actor provisioning failed" }, 500);
  }
});
