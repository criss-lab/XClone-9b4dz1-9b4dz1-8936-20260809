import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const CLIENT = Deno.env.get("PAYPAL_CLIENT_ID");
const SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET");
const WEBHOOK_ID = Deno.env.get("PAYPAL_WEBHOOK_ID");
const ENV = (Deno.env.get("PAYPAL_ENV") || "sandbox").toLowerCase();
const BASE = ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

async function token() {
  if (!CLIENT || !SECRET) throw new Error("PAYPAL_NOT_CONFIGURED");
  const r = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${CLIENT}:${SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!r.ok) throw new Error(`PAYPAL_AUTH_${r.status}`);
  return (await r.json()).access_token as string;
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!WEBHOOK_ID) return json({ error: "PAYPAL_WEBHOOK_NOT_CONFIGURED" }, 500);
    const bodyText = await req.text();
    const event = JSON.parse(bodyText);
    const h = (name: string) => req.headers.get(name) || "";
    const verification = { auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"), transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"), webhook_id: WEBHOOK_ID, webhook_event: event };
    const access = await token();
    const vr = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify(verification) });
    const vd = await vr.json();
    const verified = vr.ok && vd.verification_status === "SUCCESS";
    const { data: saved, error: saveError } = await admin.from("paypal_webhook_events").insert({ event_id: event.id, event_type: event.event_type || "unknown", transmission_id: h("paypal-transmission-id"), resource_id: event.resource?.id || null, payload: event, verified }).select("id,processed").single();
    if (saveError && !saveError.message.includes("duplicate")) return json({ error: "Webhook persistence failed" }, 500);
    if (!verified) return json({ error: "Webhook signature verification failed" }, 400);
    if (saved?.processed) return json({ ok: true, duplicate: true });

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const capture = event.resource;
      const orderId = capture?.supplementary_data?.related_ids?.order_id;
      if (orderId) {
        const { data: order } = await admin.from("paypal_orders").select("order_id,amount,currency,capture_id").eq("order_id", orderId).single();
        if (order && !order.capture_id) {
          const amount = Number(capture.amount?.value);
          const currency = String(capture.amount?.currency_code || "").toUpperCase();
          if (amount === Number(order.amount) && currency === String(order.currency).toUpperCase()) {
            await admin.rpc("credit_wallet_from_paypal", { p_order_id: orderId, p_capture_id: capture.id, p_amount: amount, p_currency: currency, p_provider_status: capture.status || "COMPLETED", p_metadata: { source: "paypal_webhook", event_id: event.id } });
          }
        }
      }
    }
    await admin.from("paypal_webhook_events").update({ processed: true, processed_at: new Date().toISOString() }).eq("event_id", event.id);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Webhook processing failed" }, 500);
  }
});
