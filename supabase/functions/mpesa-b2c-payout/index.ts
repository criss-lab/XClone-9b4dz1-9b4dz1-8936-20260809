import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MPESA_BASE = 'https://api.safaricom.co.ke';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function getToken(key: string, secret: string) {
  const res = await fetch(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` } });
  if (!res.ok) throw new Error(`Token fetch failed (${res.status})`);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('No access_token');
  return data.access_token;
}

function phone(raw: string) {
  const d = raw.replace(/\D/g, '');
  if (d.startsWith('254') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 10) return `254${d.slice(1)}`;
  if ((d.startsWith('7') || d.startsWith('1')) && d.length === 9) return `254${d}`;
  throw new Error('Invalid phone number');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !service) return json({ success: false, error: 'Supabase service configuration is missing' }, 500);
  const admin = createClient(supabaseUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (authError || !user) return json({ success: false, error: 'Unauthorized — invalid session' }, 401);

    const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY');
    const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET');
    const securityCredential = Deno.env.get('MPESA_SECURITY_CRED');
    const shortCode = Deno.env.get('MPESA_B2C_SHORTCODE') ?? Deno.env.get('MPESA_SHORTCODE');
    const initiator = Deno.env.get('MPESA_INITIATOR_NAME');
    const usdKesRate = Number(Deno.env.get('MPESA_USD_KES_RATE'));
    if (!consumerKey || !consumerSecret || !securityCredential || !shortCode || !initiator) throw new Error('M-Pesa payout secrets are not configured');
    if (!Number.isFinite(usdKesRate) || usdKesRate <= 0) throw new Error('MPESA_USD_KES_RATE is not configured');

    const body = await req.json() as { phone?: string; amount?: number | string; purpose?: string; idempotency_key?: string };
    const destination = phone(String(body.phone ?? ''));
    const kes = Math.floor(Number(body.amount));
    if (!Number.isFinite(kes) || kes < 10) throw new Error('Minimum payout is KES 10');
    const idempotencyKey = String(body.idempotency_key ?? '').trim();
    if (idempotencyKey.length < 12) throw new Error('A stable idempotency_key is required');
    const usd = Math.round((kes / usdKesRate) * 100) / 100;

    const resultUrl = Deno.env.get('MPESA_B2C_RESULT_URL') ?? `${supabaseUrl}/functions/v1/mpesa-callback`;
    const timeoutUrl = Deno.env.get('MPESA_B2C_TIMEOUT_URL') ?? `${supabaseUrl}/functions/v1/mpesa-callback`;
    const { data: reserved, error: reserveError } = await admin.rpc('reserve_wallet_withdrawal_idempotent', {
      p_user_id: user.id,
      p_amount: usd,
      p_currency: 'USD',
      p_payment_method: 'mpesa',
      p_provider: 'mpesa',
      p_provider_reference: null,
      p_idempotency_key: idempotencyKey,
      p_description: `M-Pesa withdrawal — KES ${kes.toLocaleString()} to ${destination}`,
      p_metadata: { phone: destination, kes_amount: kes, exchange_rate: usdKesRate, purpose: body.purpose ?? 'withdrawal' },
    });
    if (reserveError || !reserved?.id) throw new Error(reserveError?.message ?? 'Unable to reserve wallet funds');
    const txId = reserved.id as string;

    // A replay of the same idempotency key must not call Safaricom again.
    if (reserved.provider_reference) {
      return json({ success: true, transaction_id: txId, conversation_id: reserved.provider_reference, idempotent_replay: true, message: 'Existing M-Pesa withdrawal returned.' });
    }

    try {
      const token = await getToken(consumerKey, consumerSecret);
      const payload = {
        InitiatorName: initiator,
        SecurityCredential: securityCredential,
        CommandID: 'BusinessPayment',
        Amount: kes,
        PartyA: shortCode,
        PartyB: destination,
        Remarks: body.purpose ?? 'Wallet Withdrawal',
        QueueTimeOutURL: timeoutUrl,
        ResultURL: resultUrl,
        Occasion: body.purpose ?? 'Testagram Wallet Withdrawal',
      };
      const res = await fetch(`${MPESA_BASE}/mpesa/b2c/v1/paymentrequest`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json() as { ResponseCode?: string; errorMessage?: string; ResponseDescription?: string; ConversationID?: string; OriginatorConversationID?: string };
      if (!res.ok || String(data.ResponseCode) !== '0') throw new Error(data.errorMessage ?? data.ResponseDescription ?? `B2C failed (${res.status})`);
      const conversationId = data.ConversationID ?? data.OriginatorConversationID;
      if (!conversationId) throw new Error('M-Pesa did not return a conversation id');

      const { error: updateError } = await admin.from('wallet_transactions').update({ provider_reference: conversationId, provider_status: 'ACCEPTED', reference: conversationId }).eq('id', txId).eq('status', 'pending');
      if (updateError) throw new Error(`Unable to persist M-Pesa payout reference: ${updateError.message}`);
      return json({ success: true, transaction_id: txId, conversation_id: conversationId, originator_id: data.OriginatorConversationID, message: `KES ${kes.toLocaleString()} is being sent to your M-Pesa` });
    } catch (providerError) {
      await admin.rpc('fail_wallet_withdrawal', { p_transaction_id: txId, p_provider_reference: null, p_provider_status: 'FAILED', p_reason: providerError instanceof Error ? providerError.message : 'M-Pesa provider failure' });
      throw providerError;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ success: false, error: message }, 400);
  }
});
