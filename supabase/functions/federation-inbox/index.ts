import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { actorKeyMatches, federationJson } from "../_shared/federation-security.ts";
import { processActivityCompat } from "../_shared/activitypub-compat.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const MAX_BODY = 2_000_000;
const MAX_CLOCK_SKEW = 300;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "accept,content-type,date,digest,signature,signature-input,content-digest,host,x-testagram-edge-verified,x-testagram-verified-actor", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const text = (v: unknown) => typeof v === "string" ? v : "";
const uri = (v: unknown) => typeof v === "string" ? v : v && typeof v === "object" ? text((v as Record<string, unknown>).id) : "";
const b64 = (x: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(x)));
const ub64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function pemToBytes(pem: string) { return ub64(pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "")); }
function sigParts(value: string) { const out: Record<string, string> = {}; for (const part of value.split(/,(?=\w+=)/)) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/^"|"$/g, ""); } return out; }

async function verifyDirectLegacy(req: Request, raw: string, actorUri: string) {
  const signature = req.headers.get("signature"), digest = req.headers.get("digest"), date = req.headers.get("date");
  if (!signature || !digest || !date) throw new Error("missing HTTP signature headers");
  const when = Date.parse(date); if (!Number.isFinite(when) || Math.abs(Date.now() - when) > 12 * 60 * 60 * 1000) throw new Error("stale Date header");
  const expected = `SHA-256=${b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))}`;
  if (digest.toLowerCase() !== expected.toLowerCase()) throw new Error("digest mismatch");
  const parsed = sigParts(signature); if ((parsed.algorithm || "").toLowerCase() !== "rsa-sha256" || !parsed.signature || !parsed.keyId || !parsed.headers) throw new Error("unsupported HTTP signature");
  const keyActor = parsed.keyId.split("#")[0]; if (keyActor !== actorUri) throw new Error("signature key owner does not match actor");
  const remote = await federationJson(actorUri); if (!actorKeyMatches(remote, actorUri)) throw new Error("remote actor public key is invalid");
  const key = await crypto.subtle.importKey("spki", pemToBytes(remote.publicKey.publicKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const u = new URL(req.url), lines: string[] = [];
  for (const header of parsed.headers.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (header === "(request-target)") lines.push(`(request-target): ${req.method.toLowerCase()} ${u.pathname}${u.search}`);
    else if (header === "host") lines.push(`host: ${u.host}`);
    else { const value = req.headers.get(header); if (value === null) throw new Error(`signed header missing: ${header}`); lines.push(`${header}: ${value}`); }
  }
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, ub64(parsed.signature), new TextEncoder().encode(lines.join("\n")))) throw new Error("HTTP signature invalid");
  return parsed.keyId;
}

function parseRfcInput(value: string) {
  const match = value.match(/^sig1=(\([^)]*\))(.*)$/); if (!match) throw new Error("malformed Signature-Input");
  const components = [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const params = match[1] + match[2];
  const created = Number(match[2].match(/;created=(\d+)/)?.[1] || 0);
  const keyId = match[2].match(/;keyid="([^"]+)"/)?.[1] || '';
  const alg = match[2].match(/;alg="([^"]+)"/)?.[1] || '';
  return { components, params, created, keyId, alg };
}

async function verifyDirectRfc9421(req: Request, raw: string, actorUri: string) {
  const input = req.headers.get("signature-input"), signature = req.headers.get("signature"), digest = req.headers.get("content-digest");
  if (!input || !signature || !digest) throw new Error("missing RFC9421 signature headers");
  const parsed = parseRfcInput(input);
  if (parsed.alg !== 'rsa-v1_5-sha256') throw new Error('unsupported RFC9421 algorithm');
  if (parsed.keyId.split('#')[0] !== actorUri) throw new Error('RFC9421 key owner does not match actor');
  if (!parsed.created || Math.abs(Date.now() / 1000 - parsed.created) > MAX_CLOCK_SKEW) throw new Error('stale RFC9421 signature');
  if (parsed.components.length !== 3 || !parsed.components.includes('@method') || !parsed.components.includes('@target-uri') || !parsed.components.includes('content-digest')) throw new Error('RFC9421 required components missing');
  const digestMatch = digest.match(/^sha-256=:([^:]+):$/i); if (!digestMatch) throw new Error('unsupported Content-Digest');
  const expected = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))); if (digestMatch[1] !== expected) throw new Error('Content-Digest mismatch');
  const signatureMatch = signature.match(/^sig1=:([^:]+):$/); if (!signatureMatch) throw new Error('malformed RFC9421 Signature');
  const remote = await federationJson(actorUri); if (!actorKeyMatches(remote, actorUri)) throw new Error('remote actor public key is invalid');
  const key = await crypto.subtle.importKey('spki', pemToBytes(remote.publicKey.publicKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const base = `"@method": ${req.method}\n"@target-uri": ${new URL(req.url).toString()}\n"content-digest": ${digest}\n"@signature-params": ${parsed.params}`;
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, ub64(signatureMatch[1]), new TextEncoder().encode(base))) throw new Error('RFC9421 signature invalid');
  return parsed.keyId;
}

async function verifyDirectSignature(req: Request, raw: string, actorUri: string) {
  if (req.headers.get('signature-input')) return verifyDirectRfc9421(req, raw, actorUri);
  return verifyDirectLegacy(req, raw, actorUri);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!/(activity\+json|ld\+json|application\/json)/i.test(req.headers.get("content-type") || "")) return json({ error: "Unsupported ActivityPub content type" }, 415);
  try {
    const raw = await req.text(); if (!raw || raw.length > MAX_BODY) return json({ error: "Invalid activity body" }, 400);
    const activity = JSON.parse(raw) as Record<string, unknown>;
    const type = text(activity.type), actor = uri(activity.actor), activityId = text(activity.id) || `urn:testagram:inbound:${crypto.randomUUID()}`;
    if (!type || !actor || !/^https:\/\//i.test(actor)) return json({ error: "Activity type and HTTPS actor are required" }, 400);
    const edgeVerified = req.headers.get("x-testagram-edge-verified") === "true";
    const edgeActor = req.headers.get("x-testagram-verified-actor") || "";
    let verifiedKeyId = "edge";
    let expiresAt = new Date(Date.now() + MAX_CLOCK_SKEW * 1000).toISOString();
    if (edgeVerified) {
      const edgeCredential = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim() || (req.headers.get("apikey") || "").trim();
      if (!SERVICE || edgeCredential !== SERVICE) return json({ error: "Invalid federation edge credential" }, 401);
      if (!edgeActor || edgeActor !== actor) return json({ error: "Edge actor verification mismatch" }, 401);
      verifiedKeyId = `${edgeActor}#edge-verified`;
    } else {
      const verified = await verifyDirectSignature(req, raw, actor); verifiedKeyId = verified; expiresAt = new Date(Date.now() + MAX_CLOCK_SKEW * 1000).toISOString();
    }
    const replay = await admin.from("federation_replays").insert({ activity_uri: activityId, actor_uri: actor, signature_key_id: verifiedKeyId, expires_at: expiresAt });
    if (replay.error) { if (replay.error.code === "23505") return new Response(null, { status: 202, headers: CORS }); throw replay.error; }
    const received = new Date().toISOString();
    const persisted = await admin.from("federated_activities").upsert({ uri: activityId, activity_type: type, actor_uri: actor, object_uri: uri(activity.object) || null, target_uri: uri(activity.target) || null, raw_activity: activity, received_at: received, processed_at: null, processing_error: null, last_processing_error: null, processing_state: "processing", processing_started_at: received, next_processing_at: null, processing_attempts: 1, dead_at: null }, { onConflict: "uri" }).select("id").single();
    if (persisted.error) throw persisted.error;
    let last = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await processActivityCompat(admin, activity, actor);
        await admin.from("federated_activities").update({ processed_at: new Date().toISOString(), processing_started_at: null, processing_error: null, last_processing_error: null, processing_state: "processed", next_processing_at: null, processing_attempts: attempt, dead_at: null }).eq("uri", activityId);
        return new Response(null, { status: 202, headers: CORS });
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
        await admin.from("federated_activities").update({ processing_attempts: attempt, processing_error: last, last_processing_error: last }).eq("uri", activityId);
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
      }
    }
    await admin.from("federated_activities").update({ processing_error: last, last_processing_error: last, processing_state: "retry", processing_started_at: null, next_processing_at: new Date(Date.now() + 30000).toISOString() }).eq("uri", activityId);
    return new Response(null, { status: 202, headers: CORS });
  } catch (error) {
    console.error("[federation-inbox] rejected", error);
    return json({ error: error instanceof Error ? error.message : "Malformed ActivityPub request" }, 401);
  }
});