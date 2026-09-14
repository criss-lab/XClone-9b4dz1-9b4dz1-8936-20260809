import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const env = () => ({
  url: Deno.env.get("SUPABASE_URL")!,
  key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
});

async function queryEvents(after: number, limit: number) {
  const { url, key } = env();
  const params = new URLSearchParams({
    select: "seq,activity_id,activity_type,actor_url,object_uri,direction,payload,created_at",
    order: "seq.asc",
    limit: String(limit),
  });
  if (after > 0) params.set("seq", `gt.${after}`);
  const response = await fetch(`${url}/rest/v1/federation_relay_events?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`relay query failed: ${response.status}`);
  return response.json();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return json({ error: "GET required" }, 405);

  try {
    const url = new URL(request.url);
    const afterRaw = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
    const after = Number.isFinite(afterRaw) && afterRaw >= 0 ? afterRaw : 0;
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
    const events = await queryEvents(after, limit) as Array<{ seq: number }>;
    const next = events.length ? events[events.length - 1].seq : after;
    return json({
      protocol: "testagram-relay-v1",
      events,
      cursor: { after, next, hasMore: events.length === limit },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Relay query failed" }, 500);
  }
});
