import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const USD_TO_KES = 130;
const accepted = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const stk = body?.Body?.stkCallback;
    if (stk) {
      const checkoutId = String(stk.CheckoutRequestID || '');
      const resultCode = Number(stk.ResultCode);
      const resultDesc = String(stk.ResultDesc || '');
      let receipt: string | null = null;
      let amountKes: number | null = null;
      for (const item of (stk.CallbackMetadata?.Item ?? [])) {
        if (item.Name === 'MpesaReceiptNumber') receipt = item.Value == null ? null : String(item.Value);
        if (item.Name === 'Amount') amountKes = Number(item.Value);
      }
      const status = resultCode === 0 ? 'completed' : 'failed';
      const { data: tx, error } = await supabaseAdmin.from('mpesa_transactions').update({ status, result_code: String(resultCode), result_desc: resultDesc, mpesa_receipt_number: receipt }).eq('checkout_request_id', checkoutId).select('user_id, purpose, metadata').maybeSingle();
      if (error) console.error('[mpesa-callback] STK ledger update:', error.message);
      if (status === 'completed' && tx?.user_id && Number.isFinite(amountKes) && amountKes! > 0) {
        const usd = Math.round((amountKes! / USD_TO_KES) * 100) / 100;
        const reference = receipt || checkoutId;
        const { error: creditError } = await supabaseAdmin.rpc('credit_wallet_deposit', { p_user_id: tx.user_id, p_amount: usd, p_currency: 'USD', p_provider: 'mpesa', p_provider_reference: reference, p_provider_status: 'COMPLETED', p_payment_method: 'mpesa', p_description: `M-Pesa top-up — KES ${amountKes!.toLocaleString()} (Ref: ${reference})`, p_metadata: tx.metadata ?? {} });
        if (creditError) console.error('[mpesa-callback] wallet credit:', creditError.message);
      }
      return accepted();
    }

    const b2c = body?.Result;
    if (b2c) {
      const conversationId = String(b2c.ConversationID || b2c.OriginatorConversationID || '');
      const resultCode = Number(b2c.ResultCode);
      const resultDesc = String(b2c.ResultDesc || '');
      const status = resultCode === 0 ? 'completed' : 'failed';
      const { data: tx, error } = await supabaseAdmin.from('mpesa_transactions').update({ status, result_code: String(resultCode), result_desc: resultDesc }).eq('checkout_request_id', conversationId).select('user_id').maybeSingle();
      if (error) console.error('[mpesa-callback] B2C ledger update:', error.message);
      if (tx?.user_id) {
        const { data: pending, error: lookupError } = await supabaseAdmin.from('wallet_transactions').select('id,status').eq('user_id', tx.user_id).eq('type', 'withdrawal').eq('provider', 'mpesa').eq('provider_reference', conversationId).limit(1).maybeSingle();
        if (lookupError) console.error('[mpesa-callback] wallet lookup:', lookupError.message);
        if (pending?.id) {
          if (status === 'completed') await supabaseAdmin.rpc('complete_wallet_withdrawal', { p_transaction_id: pending.id, p_provider_reference: conversationId, p_provider_status: 'COMPLETED' });
          else await supabaseAdmin.rpc('fail_wallet_withdrawal', { p_transaction_id: pending.id, p_provider_reference: conversationId, p_provider_status: 'FAILED', p_reason: `M-Pesa withdrawal failed: ${resultDesc}` });
        }
      }
      return accepted();
    }
    return accepted();
  } catch (err) {
    console.error('[mpesa-callback] Error:', err instanceof Error ? err.message : String(err));
    return accepted();
  }
});
