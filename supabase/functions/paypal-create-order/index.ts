import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET");
const PAYPAL_ENV = (Deno.env.get("PAYPAL_ENV") || "sandbox").toLowerCase();
const PAYPAL_BASE = PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const CORS = { ...supabaseCorsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

async function paypalToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PAYPAL_NOT_CONFIGURED");
  const basic = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!response.ok) throw new Error(`PAYPAL_AUTH_${response.status}`);
  const payload = await response.json();
  if (!payload?.access_token || typeof payload.access_token !== "string") throw new Error("PAYPAL_AUTH_TOKEN_MISSING");
  return payload.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Authentication required" }, 401);
    const jwt = auth.replace(/^Bearer\s+/i, "");
    const authClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !user) return json({ error: "Invalid authentication" }, 401);

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    const currency = String(body.currency || "USD").toUpperCase();
    const paypalEmail = String(body.paypal_email || "").trim().toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return json({ error: "Enter a valid amount between 1 and 100,000 USD." }, 400);
    if (currency !== "USD") return json({ error: "PayPal wallet top-ups currently support USD only." }, 400);
    if (paypalEmail.length > 254 || !EMAIL_RE.test(paypalEmail)) return json({ error: "Enter a valid PayPal email address." }, 400);

    const returnUrl = typeof body.return_url === "string" && /^https:\/\//i.test(body.return_url) ? body.return_url : null;
    const cancelUrl = typeof body.cancel_url === "string" && /^https:\/\//i.test(body.cancel_url) ? body.cancel_url : null;
    const { data: wallet, error: walletError } = await admin.rpc("ensure_user_wallet", { p_user_id: user.id, p_currency: currency });
    if (walletError || !wallet?.id) return json({ error: "Wallet provisioning failed" }, 500);
    if (wallet.currency !== currency && Number(wallet.balance) !== 0) return json({ error: "Wallet currency is fixed once funded" }, 409);

    const { error: emailError } = await admin.from("wallets").update({ paypal_email: paypalEmail, updated_at: new Date().toISOString() }).eq("id", wallet.id).eq("user_id", user.id);
    if (emailError) return json({ error: "Unable to save PayPal email" }, 500);

    const amountCents = Math.round(amount * 100);
    if (amountCents <= 0) return json({ error: "Invalid amount" }, 400);
    const accessToken = await paypalToken();
    const experienceContext = { brand_name: "Testagram", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", ...(returnUrl && cancelUrl ? { return_url: returnUrl, cancel_url: cancelUrl } : {}) };
    const orderPayload = { intent: "CAPTURE", purchase_units: [{ reference_id: wallet.id, custom_id: user.id, amount: { currency_code: currency, value: amount.toFixed(2) }, description: "Testagram wallet top-up" }], payment_source: { paypal: { experience_context: experienceContext } } };

    const paypal = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "PayPal-Request-Id": crypto.randomUUID(), Prefer: "return=representation" }, body: JSON.stringify(orderPayload) });
    const raw = await paypal.json().catch(() => ({}));
    if (!paypal.ok) { console.error("PayPal order creation rejected", paypal.status, raw?.name, raw?.message); return json({ error: "PayPal order creation failed", detail: raw?.message || raw?.name || "PayPal rejected the order" }, 502); }

    const approvalUrl = raw.links?.find((link: { rel?: string }) => link.rel === "payer-action" || link.rel === "approve")?.href || null;
    if (!approvalUrl || !raw.id) return json({ error: "PayPal approval URL was not returned" }, 502);

    const { data: tx, error: txError } = await admin.from("wallet_transactions").insert({ user_id: user.id, wallet_id: wallet.id, kind: "topup", type: "deposit", amount, amount_cents: amountCents, currency, direction: "credit", status: "pending", provider: "paypal", provider_order_id: raw.id, provider_status: raw.status || "CREATED", payment_method: "paypal", description: "PayPal wallet top-up", metadata: { paypal_order_id: raw.id, paypal_email: paypalEmail } }).select("id").single();
    if (txError || !tx?.id) { console.error("Wallet transaction persistence failed", txError?.message); return json({ error: "Wallet transaction persistence failed" }, 500); }

    const { error: insertError } = await admin.from("paypal_orders").insert({ user_id: user.id, wallet_id: wallet.id, wallet_transaction_id: tx.id, transaction_id: null, paypal_order_id: raw.id, order_id: raw.id, amount_cents: amountCents, amount, currency, status: "created", approval_url: approvalUrl, metadata: { paypal_order_id: raw.id, paypal_email: paypalEmail }, updated_at: new Date().toISOString() });
    if (insertError) { await admin.from("wallet_transactions").delete().eq("id", tx.id); console.error("PayPal order persistence failed", insertError.message); return json({ error: "Order persistence failed" }, 500); }

    return json({ ok: true, orderId: raw.id, status: raw.status, approvalUrl, currency, amount });
  } catch (error) {
    console.error("PayPal create-order error", error);
    return json({ error: error instanceof Error ? error.message : "PayPal order creation failed" }, 500);
  }
});
