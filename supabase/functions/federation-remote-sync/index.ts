import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveRemoteActor } from "../_shared/remote-materialization.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, accept, x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function authenticatedUser(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET") return json({ ok: true, service: "testagram-federation-remote-sync", version: "1.0" });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const userId = await authenticatedUser(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  try {
    const body = await req.json();
    const acct = typeof body?.acct === "string" ? body.acct.trim() : typeof body?.actorUrl === "string" ? body.actorUrl.trim() : "";
    if (!acct) return json({ error: "acct or actorUrl is required" }, 400);
    const fetchPosts = Math.min(Math.max(Number(body?.fetchPosts ?? 10), 0), 30);
    const result = await resolveRemoteActor(admin, acct, fetchPosts);
    return json({ ok: true, userId, ...result });
  } catch (error) {
    console.error("[federation-remote-sync] failed", error);
    return json({ error: error instanceof Error ? error.message : "Remote federation sync failed" }, 422);
  }
});
