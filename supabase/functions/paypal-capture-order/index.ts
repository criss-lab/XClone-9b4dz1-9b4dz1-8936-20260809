import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET");
const PAYPAL_ENV = (Deno.env.get("PAYPAL_ENV") || "sandbox").toLowerCase();
const PAYPAL_BASE = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";
const CORS = {
  ...supabaseCorsHeaders,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function paypalToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("PAYPAL_NOT_CONFIGURED");
  }

  const basic = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(`PAYPAL_AUTH_${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.access_token || typeof payload.access_token !== "string") {
    throw new Error("PAYPAL_AUTH_TOKEN_MISSING");
  }

  return payload.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return json({ error: "Authentication required" }, 401);
    }

    const jwt = auth.replace(/^Bearer\s+/i, "");
    const authClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
    });
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(jwt);

    if (authError || !user) {
      return json({ error: "Invalid authentication" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const orderId = body?.orderId;
    if (!orderId || typeof orderId !== "string" || orderId.length > 64) {
      return json({ error: "orderId is required" }, 400);
    }

    const { data: order, error: orderError } = await admin
      .from("paypal_orders")
      .select("*")
      .or(`order_id.eq.${orderId},paypal_order_id.eq.${orderId}`)
      .eq("user_id", user.id)
      .maybeSingle();

    if (orderError || !order) {
      return json({ error: "Order not found" }, 404);
    }

    const existingCapture = order.capture_id || order.paypal_capture_id;
    if (existingCapture) {
      return json({
        ok: true,
        alreadyCaptured: true,
        orderId,
        captureId: existingCapture,
      });
    }

    const accessToken = await paypalToken();
    const response = await fetch(
      `${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `testagram-capture-${orderId}`,
          Prefer: "return=representation",
        },
        body: "{}",
      },
    );

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("PayPal capture rejected", response.status, raw?.name, raw?.message);
      return json({
        error: "PayPal capture failed",
        detail: raw?.message || raw?.name || "PayPal rejected the capture",
      }, 502);
    }

    const capture = raw?.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture?.id || capture.status !== "COMPLETED") {
      return json({
        error: "Payment not completed",
        status: capture?.status || raw?.status || "UNKNOWN",
      }, 409);
    }

    const paidAmount = Number(capture.amount?.value);
    const paidCurrency = String(capture.amount?.currency_code || "").toUpperCase();
    const expectedAmount = Number(order.amount ?? Number(order.amount_cents) / 100);
    const expectedCurrency = String(order.currency || "").toUpperCase();

    if (
      !Number.isFinite(paidAmount) ||
      paidAmount !== expectedAmount ||
      paidCurrency !== expectedCurrency
    ) {
      console.error("PayPal captured amount mismatch", {
        orderId,
        paidAmount,
        paidCurrency,
        expectedAmount,
        expectedCurrency,
      });
      return json({ error: "Captured amount mismatch" }, 409);
    }

    const { data: finalized, error: finalizeError } = await admin.rpc(
      "finalize_paypal_topup",
      {
        p_order_id: orderId,
        p_capture_id: capture.id,
      },
    );

    if (finalizeError) {
      console.error("PayPal wallet finalization failed", finalizeError.message);
      return json({
        error: "Wallet credit failed",
        detail: finalizeError.message,
      }, 500);
    }

    return json({
      ok: true,
      orderId,
      captureId: capture.id,
      wallet: finalized,
    });
  } catch (error) {
    console.error("PayPal capture-order error", error);
    return json({
      error: error instanceof Error ? error.message : "PayPal capture failed",
    }, 500);
  }
});
