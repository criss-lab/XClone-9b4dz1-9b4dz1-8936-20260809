import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const text = (value: unknown) => typeof value === "string" ? value : "";
const objectId = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return text((value as Record<string, unknown>).id);
  return "";
};

function objectRow(payload: Record<string, unknown>) {
  const raw = payload.object;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const object = raw as Record<string, unknown>;
  const uri = objectId(object.id) || text(payload.object_uri);
  if (!uri) return null;
  const attributed = object.attributedTo;
  const actor = text(attributed) || objectId(attributed) || text(payload.actor_url) || null;
  const published = text(object.published) || null;
  const updated = text(object.updated) || null;
  const type = text(object.type) || "Object";
  return {
    object_url: uri,
    actor_url: actor,
    object_type: type,
    object: object,
    published_at: published,
    updated_at: updated,
    fetched_at: new Date().toISOString(),
  };
}

async function applyEvent(event: Record<string, unknown>) {
  const type = text(event.activity_type).toLowerCase();
  const payload = (event.payload && typeof event.payload === "object")
    ? event.payload as Record<string, unknown>
    : {};
  const objectUri = text(event.object_uri) || objectId(payload.object);

  if (type === "create" || type === "update") {
    const row = objectRow(payload);
    if (!row) return "ignored";
    const { error } = await admin.from("federation_objects").upsert(row, { onConflict: "object_url" });
    if (error) throw error;
    return "object_upserted";
  }

  if (type === "delete") {
    if (!objectUri) return "ignored";
    const now = new Date().toISOString();
    const { error } = await admin.from("federation_objects")
      .update({ deleted_at: now, updated_at: now })
      .eq("object_url", objectUri);
    if (error) throw error;
    return "object_deleted";
  }

  if (type === "like" || type === "announce") {
    if (!objectUri) return "ignored";
    const column = type === "like" ? "like_count" : "announce_count";
    const { data: current, error: readError } = await admin
      .from("federated_objects")
      .select(`object_url,${column}`)
      .eq("object_url", objectUri)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return "engagement_deferred";
    const next = Math.max(0, Number(current[column] ?? 0) + 1);
    const { error } = await admin.from("federated_objects")
      .update({ [column]: next, updated_at: new Date().toISOString() })
      .eq("object_url", objectUri);
    if (error) throw error;
    return "engagement_incremented";
  }

  if (type === "undo") {
    const nested = payload.object;
    const nestedType = nested && typeof nested === "object" ? text((nested as Record<string, unknown>).type).toLowerCase() : "";
    const target = nested && typeof nested === "object"
      ? objectId((nested as Record<string, unknown>).object) || text((nested as Record<string, unknown>).object)
      : objectUri;
    if (!target) return "ignored";
    const column = nestedType === "like" ? "like_count" : nestedType === "announce" ? "announce_count" : null;
    if (!column) return "ignored";
    const { data: current, error: readError } = await admin
      .from("federated_objects")
      .select(`object_url,${column}`)
      .eq("object_url", target)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return "engagement_deferred";
    const next = Math.max(0, Number(current[column] ?? 0) - 1);
    const { error } = await admin.from("federated_objects")
      .update({ [column]: next, updated_at: new Date().toISOString() })
      .eq("object_url", target);
    if (error) throw error;
    return "engagement_decremented";
  }

  return "ignored";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "GET or POST required" }, 405);

  try {
    const url = new URL(request.url);
    const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 1), 250);

    const lease = await admin.rpc("claim_federation_appview_lease", { p_lease_seconds: 45 });
    if (lease.error) throw lease.error;
    const claim = Array.isArray(lease.data) ? lease.data[0] : lease.data;
    if (!claim) return json({ ok: true, status: "busy" }, 409);

    const cursor = Number(claim.cursor ?? 0);
    const { data: events, error: eventError } = await admin
      .from("federation_relay_events")
      .select("seq,activity_id,activity_type,actor_url,object_uri,direction,source_table,payload,created_at")
      .gt("seq", cursor)
      .order("seq", { ascending: true })
      .limit(limit);
    if (eventError) throw eventError;

    let processed = 0;
    let ignored = 0;
    let failed = 0;
    let nextCursor = cursor;
    let lastError = null as string | null;

    for (const event of events ?? []) {
      try {
        const result = await applyEvent(event as Record<string, unknown>);
        if (result === "ignored" || result === "engagement_deferred") ignored++;
        else processed++;
        nextCursor = Number(event.seq);
      } catch (error) {
        failed++;
        lastError = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    const { data: state } = await admin.from("federation_appview_state")
      .select("processed_count,failed_count")
      .eq("id", true)
      .maybeSingle();

    const { error: stateError } = await admin.from("federation_appview_state")
      .update({
        cursor: nextCursor,
        lease_until: null,
        processed_count: Number(state?.processed_count ?? 0) + processed,
        failed_count: Number(state?.failed_count ?? 0) + failed,
        last_error: lastError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    if (stateError) throw stateError;

    return json({
      ok: true,
      protocol: "testagram-appview-v1",
      cursor: { before: cursor, after: nextCursor, hasMore: (events?.length ?? 0) === limit },
      processed,
      ignored,
      failed,
      ranking_source: "federated_objects",
      unified_with_local_feed: true,
    });
  } catch (error) {
    console.error("[federation-appview]", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "AppView processing failed" }, 500);
  }
});
