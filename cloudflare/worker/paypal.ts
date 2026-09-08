export interface PayPalEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SECRET_KEY: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_ENV?: string;
  PAYPAL_WEBHOOK_ID?: string;
}

const paypalBase = (env: PayPalEnv) => (env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function token(env: PayPalEnv) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const r = await fetch(`${paypalBase(env)}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!r.ok) throw new Error(`paypal_oauth_${r.status}`);
  return (await r.json() as { access_token: string }).access_token;
}

async function paypal(env: PayPalEnv, path: string, init: RequestInit = {}) {
  const access = await token(env);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${access}`);
  headers.set('Content-Type', 'application/json');
  return fetch(`${paypalBase(env)}${path}`, { ...init, headers });
}

async function userId(request: Request, env: PayPalEnv) {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) return null;
  return (await r.json() as { id?: string }).id || null;
}

async function db(env: PayPalEnv, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_SECRET_KEY);
  headers.set('Authorization', `Bearer ${env.SUPABASE_SECRET_KEY}`);
  headers.set('Content-Type', 'application/json');
  return fetch(`${env.SUPABASE_URL}${path}`, { ...init, headers });
}

async function rpc(env: PayPalEnv, name: string, body: unknown) {
  const r = await db(env, `/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase_rpc_${name}_${r.status}:${text.slice(0,300)}`);
  return text ? JSON.parse(text) : null;
}

async function ownWallet(env: PayPalEnv, uid: string) {
  const r = await db(env, `/rest/v1/wallets?select=*&user_id=eq.${encodeURIComponent(uid)}&limit=1`);
  if (!r.ok) throw new Error(`wallet_lookup_${r.status}`);
  const rows = await r.json() as Array<{ id: string; user_id: string; balance: number; paypal_email: string | null }>;
  if (!rows.length) throw new Error('WALLET_NOT_FOUND');
  if (rows[0].user_id !== uid) throw new Error('WALLET_OWNERSHIP_MISMATCH');
  return rows[0];
}

export async function handlePayPal(request: Request, env: PayPalEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/paypal/config' && request.method === 'GET') return json({ ok: true, provider: 'paypal', environment: (env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox', configured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_WEBHOOK_ID) });
  const uid = await userId(request, env);
  if (!uid && url.pathname !== '/api/paypal/webhook') return json({ error: 'Authentication required' }, 401);

  if (url.pathname === '/api/paypal/orders' && request.method === 'POST') {
    try {
      const body = await request.json() as { amount?: number | string; currency?: string; return_url?: string; cancel_url?: string };
      const amount = Number(body.amount);
      const currency = String(body.currency || 'USD').toUpperCase();
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return json({ error: 'Invalid amount' }, 400);
      if (currency !== 'USD') return json({ error: 'Only USD is currently supported for PayPal wallet topups' }, 400);
      if (!body.return_url || !body.cancel_url) return json({ error: 'return_url and cancel_url are required' }, 400);
      for (const value of [body.return_url, body.cancel_url]) { const parsed = new URL(value); if (parsed.protocol !== 'https:') return json({ error: 'return_url and cancel_url must be HTTPS URLs' }, 400); }
      const wallet = await rpc(env, 'ensure_wallet', { p_user_id: uid }) as { id: string };
      const tx = await db(env, '/rest/v1/wallet_transactions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ wallet_id: wallet.id, user_id: uid, type: 'deposit', status: 'pending', amount: Number(amount.toFixed(2)), currency, provider: 'paypal', description: 'PayPal wallet top-up', payment_method: 'paypal' }) });
      if (!tx.ok) return json({ error: 'Failed to create wallet transaction' }, 502);
      const txRows = await tx.json() as Array<{ id: string }>;
      const transactionId = txRows[0]?.id;
      if (!transactionId) return json({ error: 'Wallet transaction ID missing' }, 502);
      const orderKey = crypto.randomUUID();
      const pp = await paypal(env, '/v2/checkout/orders', { method: 'POST', headers: { 'PayPal-Request-Id': orderKey }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: transactionId, amount: { currency_code: currency, value: amount.toFixed(2) }, custom_id: uid }], application_context: { return_url: body.return_url, cancel_url: body.cancel_url, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } }) });
      const ppText = await pp.text();
      if (!pp.ok) return json({ error: 'PayPal order creation failed', detail: ppText.slice(0,300) }, 502);
      const order = JSON.parse(ppText) as { id: string; status: string; links?: Array<{ rel: string; href: string }> };
      const save = await db(env, '/rest/v1/paypal_orders', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, wallet_id: wallet.id, wallet_transaction_id: transactionId, order_id: order.id, amount: Number(amount.toFixed(2)), currency, status: order.status, raw_create_response: order }) });
      if (!save.ok) return json({ error: 'PayPal order ledger write failed' }, 502);
      return json({ ok: true, order_id: order.id, status: order.status, approval_url: order.links?.find(l => l.rel === 'approve')?.href || null, transaction_id: transactionId });
    } catch (e) { return json({ error: e instanceof Error ? e.message : 'PayPal order creation failed' }, 502); }
  }

  const captureMatch = url.pathname.match(/^\/api\/paypal\/orders\/([^/]+)\/capture$/);
  if (captureMatch && request.method === 'POST') {
    try {
      const orderId = decodeURIComponent(captureMatch[1]);
      const lookup = await db(env, `/rest/v1/paypal_orders?select=*&order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(uid!)}&limit=1`);
      if (!lookup.ok) return json({ error: 'Order lookup failed' }, 502);
      const rows = await lookup.json() as Array<any>;
      if (!rows.length) return json({ error: 'Order not found' }, 404);
      const existing = rows[0];
      if (existing.status === 'captured' && existing.capture_id) return json({ ok: true, idempotent: true, order_id: orderId, capture_id: existing.capture_id });
      const pp = await paypal(env, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', headers: { 'PayPal-Request-Id': crypto.randomUUID() }, body: '{}' });
      const text = await pp.text();
      if (!pp.ok) return json({ error: 'PayPal capture failed', detail: text.slice(0,300) }, pp.status === 422 ? 409 : 502);
      const capture = JSON.parse(text) as any;
      const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      const captureStatus = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.status;
      if (!captureId || captureStatus !== 'COMPLETED') return json({ error: 'PayPal capture not completed' }, 409);
      const final = await rpc(env, 'finalize_paypal_topup', { p_order_id: orderId, p_capture_id: captureId });
      await db(env, `/rest/v1/paypal_orders?order_id=eq.${encodeURIComponent(orderId)}`, { method: 'PATCH', body: JSON.stringify({ raw_capture_response: capture, status: 'captured', capture_id: captureId, captured_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      return json({ ok: true, capture_id: captureId, payment: final });
    } catch (e) { return json({ error: e instanceof Error ? e.message : 'PayPal capture failed' }, 502); }
  }

  if (url.pathname === '/api/paypal/withdrawals' && request.method === 'POST') {
    try {
      const body = await request.json() as { amount?: number | string };
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return json({ error: 'Invalid amount' }, 400);
      const cleanAmount = Number(amount.toFixed(2));
      const wallet = await ownWallet(env, uid!);
      const email = wallet.paypal_email?.trim().toLowerCase();
      if (!email || !email.includes('@')) return json({ error: 'Add a valid PayPal email to your wallet payment methods first' }, 400);
      const senderItemId = crypto.randomUUID();
      const tx = await rpc(env, 'reserve_wallet_withdrawal', { p_user_id: uid, p_amount: cleanAmount, p_currency: 'USD', p_payment_method: 'paypal', p_provider: 'paypal', p_provider_reference: senderItemId, p_description: `PayPal withdrawal to ${email}`, p_metadata: { recipient_email: email, sender_item_id: senderItemId } });
      const transactionId = tx?.id;
      if (!transactionId) throw new Error('WITHDRAWAL_TRANSACTION_MISSING');
      const batchKey = crypto.randomUUID();
      const pp = await paypal(env, '/v1/payments/payouts', { method: 'POST', headers: { 'PayPal-Request-Id': batchKey }, body: JSON.stringify({ sender_batch_header: { sender_batch_id: batchKey, email_subject: 'Testagram wallet withdrawal', email_message: 'Your Testagram wallet withdrawal is being processed.' }, items: [{ recipient_type: 'EMAIL', amount: { value: cleanAmount.toFixed(2), currency: 'USD' }, receiver: email, sender_item_id: senderItemId, note: 'Testagram wallet withdrawal' }] }) });
      const text = await pp.text();
      if (!pp.ok) { await rpc(env, 'fail_wallet_withdrawal', { p_transaction_id: transactionId, p_provider_reference: senderItemId, p_provider_status: `HTTP_${pp.status}`, p_reason: 'PayPal payout creation failed' }); return json({ error: 'PayPal payout creation failed', detail: text.slice(0,300) }, 502); }
      const payout = JSON.parse(text) as any;
      await db(env, `/rest/v1/wallet_transactions?id=eq.${encodeURIComponent(transactionId)}`, { method: 'PATCH', body: JSON.stringify({ provider_status: payout?.batch_header?.batch_status || 'PENDING', metadata: { recipient_email: email, sender_item_id: senderItemId, payout_batch_id: payout?.batch_header?.payout_batch_id || null, payout_response: payout } }) });
      return json({ ok: true, transaction_id: transactionId, payout_batch_id: payout?.batch_header?.payout_batch_id || null, status: payout?.batch_header?.batch_status || 'PENDING' });
    } catch (e) { return json({ error: e instanceof Error ? e.message : 'PayPal withdrawal failed' }, 502); }
  }

  if (url.pathname === '/api/paypal/webhook' && request.method === 'POST') {
    if (!env.PAYPAL_WEBHOOK_ID) return json({ error: 'PayPal webhook is not configured' }, 503);
    const raw = await request.text();
    let event: any;
    try { event = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!event.id || !event.event_type) return json({ error: 'Invalid webhook event' }, 400);
    const transmission = request.headers.get('PAYPAL-TRANSMISSION-ID') || '';
    const ts = request.headers.get('PAYPAL-TRANSMISSION-TIME') || '';
    const cert = request.headers.get('PAYPAL-CERT-URL') || '';
    const sig = request.headers.get('PAYPAL-TRANSMISSION-SIG') || '';
    const authAlgo = request.headers.get('PAYPAL-AUTH-ALGO') || '';
    const verify = await paypal(env, '/v1/notifications/verify-webhook-signature', { method: 'POST', body: JSON.stringify({ auth_algo: authAlgo, cert_url: cert, transmission_id: transmission, transmission_sig: sig, transmission_time: ts, webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event }) });
    const verifyBody = await verify.json() as { verification_status?: string };
    if (!verify.ok || verifyBody.verification_status !== 'SUCCESS') return json({ error: 'Webhook signature verification failed' }, 400);
    const resource = event.resource || {};
    const orderId = resource?.supplementary_data?.related_ids?.order_id || resource?.custom_id || null;
    const resourceId = resource?.id || null;
    const insert = await db(env, '/rest/v1/paypal_webhook_events', { method: 'POST', headers: { Prefer: 'return=representation', 'Accept-Profile': 'public' }, body: JSON.stringify({ event_id: event.id, event_type: event.event_type, transmission_id: transmission || null, resource_id: resourceId, payload: event, verified: true, processed: false }) });
    if (insert.status === 409) return json({ ok: true, duplicate: true });
    if (!insert.ok) return json({ error: 'Webhook ledger write failed' }, 500);
    try {
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && orderId && resourceId) {
        await rpc(env, 'finalize_paypal_topup', { p_order_id: orderId, p_capture_id: resourceId });
      }
      if ((event.event_type === 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' || event.event_type === 'PAYMENT.PAYOUTS-ITEM.FAILED' || event.event_type === 'PAYMENT.PAYOUTS-ITEM.BLOCKED') && resource?.sender_item_id) {
        const senderItemId = String(resource.sender_item_id);
        const lookup = await db(env, `/rest/v1/wallet_transactions?select=id,status&provider=eq.paypal&provider_reference=eq.${encodeURIComponent(senderItemId)}&type=eq.withdrawal&limit=1`);
        if (!lookup.ok) throw new Error('PAYOUT_TRANSACTION_LOOKUP_FAILED');
        const rows = await lookup.json() as Array<{ id: string; status: string }>;
        if (rows.length) {
          if (event.event_type === 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED') await rpc(env, 'complete_wallet_withdrawal', { p_transaction_id: rows[0].id, p_provider_reference: senderItemId, p_provider_status: 'SUCCEEDED' });
          else await rpc(env, 'fail_wallet_withdrawal', { p_transaction_id: rows[0].id, p_provider_reference: senderItemId, p_provider_status: event.event_type, p_reason: resource?.errors?.[0]?.name || 'PayPal payout failed' });
        }
      }
      await db(env, `/rest/v1/paypal_webhook_events?event_id=eq.${encodeURIComponent(event.id)}`, { method: 'PATCH', body: JSON.stringify({ processed: true, processed_at: new Date().toISOString(), processing_error: null }) });
      return json({ ok: true, processed: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Webhook processing failed';
      await db(env, `/rest/v1/paypal_webhook_events?event_id=eq.${encodeURIComponent(event.id)}`, { method: 'PATCH', body: JSON.stringify({ processing_error: message.slice(0,500) }) });
      return json({ error: 'Webhook processing failed' }, 500);
    }
  }
  return json({ error: 'Not found' }, 404);
}
