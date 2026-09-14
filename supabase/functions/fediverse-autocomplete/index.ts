import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function rest(path: string) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`database ${r.status}`);
  return r.json();
}

async function webfinger(acct: string) {
  const clean = acct.replace(/^@/, "").trim();
  const [username, domain] = clean.split("@");
  if (!username || !domain) return null;
  try {
    const r = await fetch(`https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${username}@${domain}`)}`, { headers: { Accept: "application/jrd+json" } });
    if (!r.ok) return null;
    const data = await r.json();
    const link = (data.links || []).find((x: any) => x.rel === "self" && x.href && String(x.type || "").includes("activity"));
    return link?.href ? { acct: `${username}@${domain}`, actor_url: link.href, username, domain } : null;
  } catch { return null; }
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!KEY || !ANON) return json({ error: "Federation backend is not configured" }, 503);
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Authentication required" }, 401);
  const check = await fetch(`${U}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!check.ok) return json({ error: "Authentication required" }, 401);
  try {
    const body = await req.json();
    const mode = body?.mode === "hashtag" ? "hashtag" : "mention";
    const q = String(body?.q || "").trim().replace(/^[@#]/, "").slice(0, 80);
    if (!q) return json([]);

    if (mode === "hashtag") {
      const local = await rest(`hashtags?name=ilike.*${encodeURIComponent(q)}*&select=id,name&limit=8`);
      const remote = await rest(`federation_post_tags?tag_type=eq.Hashtag&name=ilike.*${encodeURIComponent(q)}*&select=name&limit=12`);
      const names = new Map<string, any>();
      for (const x of [...(local || []), ...(remote || [])]) {
        const name = String(x.name || "").replace(/^#/, "");
        if (name) names.set(name.toLowerCase(), { name });
      }
      return json([...names.values()].slice(0, 10));
    }

    const remote = await rest(`federation_remote_actors?or=(username.ilike.*${encodeURIComponent(q)}*,acct.ilike.*${encodeURIComponent(q)}*)&select=actor_url,username,acct,domain,actor&limit=8`);
    const local = await rest(`user_profiles?username=ilike.*${encodeURIComponent(q)}*&select=id,username,display_name,avatar_url&limit=8`);
    return json([
      ...(local || []).map((x: any) => ({ kind: "local", id: x.id, username: x.username, name: x.display_name || x.username, handle: `@${x.username}`, avatar_url: x.avatar_url })),
      ...(remote || []).map((x: any) => ({ kind: "remote", id: x.actor_url, username: x.username, name: x.actor?.name || x.username, handle: `@${x.acct || `${x.username}@${x.domain}`}`, actor_url: x.actor_url, avatar_url: x.actor?.icon?.url || null }))
    ].slice(0, 12));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Autocomplete failed" }, 500);
  }
});
