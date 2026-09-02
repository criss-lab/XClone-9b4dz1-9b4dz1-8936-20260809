// M-Pesa B2C (Business to Customer) Payout
import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enforceRateLimit } from '../_shared/rate-limit.ts';

const MPESA_BASE = 'https://api.safaricom.co.ke';

async function getMpesaToken(consumerKey: string, consumerSecret: string): Promise<string> {
  const credentials = btoa(`${consumerKey}:${consumerSecret}`);
  const res = await fetch(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${credentials}` } });
  if (!res.ok) throw new Error(`Token fetch failed (${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in response');
  return data.access_token;
}

function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1);
  if (digits.startsWith('7') && digits.length === 9) return '254' + digits;
  if (digits.startsWith('1') && digits.length === 9) return '254' + digits;
  throw new Error('Invalid phone number');
}

async function getFxRate(admin: ReturnType<typeof createClient>): Promise<number> {
  const { data, error } = await admin.from('platform_exchange_rates').select('rate').eq('base_currency', 'USD').eq('quote_currency', 'KES').lte('effective_at', new Date().toISOString()).order('effective_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data || Number(data.rate) <= 0) throw new Error('No active USD/KES exchange rate configured');
  return Number(data.rate);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  let reservedTransactionId: string | null = null;
  let mpesaAccepted = false;
  try {
    const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY');
    const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET');
    const shortCode = Deno.env.get('MPESA_B2C_SHORTCODE') ?? Deno.env.get('MPESA_SHORTCODE') ?? '';
    const initiatorName = Deno.env.get('MPESA_INITIATOR_NAME') ?? '';
    const securityCred = Deno.env.get('MPESA_SECURITY_CRED') ?? '';
    const resultUrl = Deno.env.get('MPESA_B2C_RESULT_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`;
    const timeoutUrl = Deno.env.get('MPESA_B2C_TIMEOUT_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`;
    if (!consumerKey || !consumerSecret || !shortCode || !initiatorName || !securityCred) throw new Error('M-Pesa B2C credentials are not configured');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Unauthorized');
    const jwtToken = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwtToken);
    if (userErr || !user) throw new Error('Unauthorized — invalid session');
    await enforceRateLimit(admin, `mpesa:b2c:user:${user.id}`, 5, 300);

    const body = await req.json();
    const { phone, amount, purpose, idempotency_key } = body;
    if (!phone) throw new Error('phone is required');
    if (!amount) throw new Error('amount is required');
    const normalisedPhone = normalisePhone(String(phone));
    const intAmount = Math.floor(Number(amount));
    if (!Number.isFinite(intAmount) || intAmount < 10) throw new Error('Minimum B2C amount is KES 10');
    const fxRate = await getFxRate(admin);
    const usdAmount = intAmount / fxRate;
    const idempotencyKey = String(idempotency_key ?? req.headers.get('Idempotency-Key') ?? crypto.randomUUID());

    const { data: existing } = await admin.from('wallet_transactions').select('id,status,provider_transaction_id,reference').eq('user_id', user.id).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing) return new Response(JSON.stringify({ success: true, idempotent_replay: true, wallet_transaction_id: existing.id, status: existing.status, conversation_id: existing.provider_transaction_id ?? existing.reference ?? null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: reservedId, error: reserveErr } = await admin.rpc('reserve_wallet_funds', { p_user_id: user.id, p_amount: usdAmount, p_idempotency_key: idempotencyKey });
    if (reserveErr || !reservedId) throw new Error(reserveErr?.message ?? 'Unable to reserve wallet funds');
    reservedTransactionId = reservedId;

    const token = await getMpesaToken(consumerKey, consumerSecret);
    const b2cPayload = { InitiatorName: initiatorName, SecurityCredential: securityCred, CommandID: 'BusinessPayment', Amount: intAmount, PartyA: shortCode, PartyB: normalisedPhone, Remarks: purpose ?? 'Creator Payout', QueueTimeOutURL: timeoutUrl, ResultURL: resultUrl, Occasion: purpose ?? 'XClone Payout' };
    const b2cRes = await fetch(`${MPESA_BASE}/mpesa/b2c/v1/paymentrequest`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b2cPayload) });
    const b2cData = await b2cRes.json();
    if (!b2cRes.ok || b2cData.ResponseCode !== '0') throw new Error(`M-Pesa B2C: ${b2cData.errorMessage ?? b2cData.ResponseDescription ?? `request failed (${b2cRes.status})`}`);
    mpesaAccepted = true;

    const { error: txUpdateErr } = await admin.from('wallet_transactions').update({ provider: 'mpesa', provider_transaction_id: b2cData.ConversationID, reference: b2cData.OriginatorConversationID, amount_kes: intAmount, fx_rate: fxRate, payment_method: 'mpesa', description: `M-Pesa withdrawal — KES ${intAmount.toLocaleString()} to ${normalisedPhone}`, metadata: { phone: normalisedPhone, purpose: purpose ?? 'creator_payout' }, updated_at: new Date().toISOString() }).eq('id', reservedTransactionId).eq('status', 'reserved');
    if (txUpdateErr) throw new Error(`Payout accepted but local transaction update failed: ${txUpdateErr.message}`);

    const { error: mpesaInsertErr } = await admin.from('mpesa_transactions').insert({ user_id: user.id, checkout_request_id: b2cData.ConversationID, merchant_request_id: b2cData.OriginatorConversationID, phone_number: normalisedPhone, amount: intAmount, currency: 'KES', type: 'b2c', purpose: purpose ?? 'creator_payout', status: 'pending', idempotency_key: idempotencyKey, wallet_transaction_id: reservedTransactionId, metadata: { fx_rate: fxRate } });
    if (mpesaInsertErr) throw new Error(`Payout accepted but provider ledger update failed: ${mpesaInsertErr.message}`);

    await admin.from('user_wallets').update({ mpesa_phone: normalisedPhone }).eq('user_id', user.id);
    await admin.from('platform_inbox').insert({ user_id: user.id, subject: 'Withdrawal Initiated 💸', body: `Your withdrawal of KES ${intAmount.toLocaleString()} ($${usdAmount.toFixed(2)}) to M-Pesa has been initiated.`, type: 'system', icon_emoji: '💸' });
    await admin.from('audit_logs').insert({ actor_user_id: user.id, action: 'mpesa_b2c_initiated', resource_type: 'wallet_transaction', resource_id: reservedTransactionId, status: 'success', metadata: { amount_kes: intAmount, amount_usd: usdAmount, fx_rate: fxRate } });

    return new Response(JSON.stringify({ success: true, wallet_transaction_id: reservedTransactionId, conversation_id: b2cData.ConversationID, originator_id: b2cData.OriginatorConversationID, message: `KES ${intAmount.toLocaleString()} is being sent to your M-Pesa` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    if (reservedTransactionId && !mpesaAccepted) await admin.rpc('release_wallet_reservation', { p_transaction_id: reservedTransactionId, p_reason: `M-Pesa request failed: ${message}` }).catch(() => undefined);
    console.error('[mpesa-b2c] Error:', message);
    return new Response(JSON.stringify({ success: false, error: message }), { status: mpesaAccepted ? 502 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
