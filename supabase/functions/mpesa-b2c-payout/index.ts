import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MPESA_BASE = 'https://api.safaricom.co.ke';
const USD_TO_KES = 130;

async function getToken(key: string, secret: string) {
  const credentials = btoa(`${key}:${secret}`);
  const res = await fetch(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${credentials}` } });
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
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) throw new Error('Unauthorized');
    const { data: { user }, error: authError } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (authError || !user) throw new Error('Unauthorized — invalid session');

    const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY');
    const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET');
    const securityCredential = Deno.env.get('MPESA_SECURITY_CRED');
    if (!consumerKey || !consumerSecret || !securityCredential) throw new Error('M-Pesa payout secrets are not configured');

    const body = await req.json() as { phone?: string; amount?: number | string; purpose?: string };
    const destination = phone(String(body.phone ?? ''));
    const kes = Math.floor(Number(body.amount));
    if (!Number.isFinite(kes) || kes < 10) throw new Error('Minimum payout is KES 10');
    const usd = Math.round((kes / USD_TO_KES) * 100) / 100;

    const shortCode = Deno.env.get('MPESA_B2C_SHORTCODE') ?? Deno.env.get('MPESA_SHORTCODE') ?? '174379';
    const initiator = Deno.env.get('MPESA_INITIATOR_NAME') ?? 'testapi';
    const resultUrl = Deno.env.get('MPESA_B2C_RESULT_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`;
    const timeoutUrl = Deno.env.get('MPESA_B2C_TIMEOUT_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`;

    // Reserve/debit the user's actual profile wallet before calling Safaricom.
    // The RPC locks the wallet row and rejects insufficient funds atomically.
    const { data: reserved, error: reserveError } = await admin.rpc('reserve_wallet_withdrawal', {
      p_user_id: user.id,
      p_amount: usd,
      p_currency: 'USD',
      p_payment_method: 'mpesa',
      p_provider: 'mpesa',
      p_description: `M-Pesa withdrawal — KES ${kes.toLocaleString()} to ${destination}`,
      p_metadata: { phone: destination, kes_amount: kes, exchange_rate: USD_TO_KES, purpose: body.purpose ?? 'withdrawal' },
    });
    if (reserveError || !reserved?.id) throw new Error(reserveError?.message ?? 'Unable to reserve wallet funds');
    const txId = reserved.id as string;

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
      const res = await fetch(`${MPESA_BASE}/mpesa/b2c/v1/paymentrequest`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json() as any;
      if (!res.ok || String(data.ResponseCode) !== '0') throw new Error(data.errorMessage ?? data.ResponseDescription ?? `B2C failed (${res.status})`);
      const conversationId = data.ConversationID ?? data.OriginatorConversationID ?? crypto.randomUUID();

      await admin.from('wallet_transactions').update({ provider_reference: conversationId, provider_status: 'ACCEPTED', reference: conversationId }).eq('id', txId);
      return new Response(JSON.stringify({ success: true, transaction_id: txId, conversation_id: conversationId, originator_id: data.OriginatorConversationID, message: `KES ${kes.toLocaleString()} is being sent to your M-Pesa` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (providerError) {
      await admin.rpc('fail_wallet_withdrawal', { p_transaction_id: txId, p_provider_reference: null, p_provider_status: 'FAILED', p_reason: providerError instanceof Error ? providerError.message : 'M-Pesa provider failure' });
      throw providerError;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return new Response(JSON.stringify({ success: false, error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
