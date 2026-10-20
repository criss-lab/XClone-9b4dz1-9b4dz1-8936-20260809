/**
 * M-Pesa webhook handler (production wallet credit)
 *
 * esbuild-safe: no Set<T> generics, no useState<T>, no useRef<T>.
 * Uses the project-standard supabase client from @/lib/supabase.
 */
import { supabase } from '@/lib/supabase';

// ── Payload type ──────────────────────────────────────────────────────────
export type MpesaCallback = {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value?: unknown }>;
      };
    };
  };
};

// ── Pure helpers (module-level, no closures) ──────────────────────────────
function extractItem(items: Array<{ Name: string; Value?: unknown }>, name: string): unknown {
  for (let i = 0; i < items.length; i++) {
    if (items[i].Name === name) return items[i].Value;
  }
  return undefined;
}

// ── Main webhook handler ─────────────────────────────────────────────────
export async function handleMpesaWebhook(payload: MpesaCallback): Promise<{
  status: string;
  credited?: number;
  newBalance?: number;
  reason?: string;
  message?: string;
}> {
  const callback = payload.Body.stkCallback;

  // Ignore failed / cancelled payments
  if (callback.ResultCode !== 0) {
    return { status: 'failed', reason: callback.ResultDesc };
  }

  const items = callback.CallbackMetadata?.Item ?? [];
  const amount  = Number(extractItem(items, 'Amount')            ?? 0);
  const phone   = String(extractItem(items, 'PhoneNumber')       ?? '');
  const receipt = String(extractItem(items, 'MpesaReceiptNumber') ?? '');

  if (!phone) return { status: 'error', message: 'PhoneNumber missing from callback' };

  // Resolve user wallet via stored mpesa_phone
  const { data: wallet } = await supabase
    .from('user_wallets')
    .select('id, user_id, balance')
    .eq('mpesa_phone', phone)
    .maybeSingle();

  if (!wallet) {
    console.warn('[mpesaWebhook] No wallet found for phone:', phone);
    return { status: 'error', message: 'Wallet not found for ' + phone };
  }

  const usdAmount  = amount / 130; // KES → USD (matches USD_TO_KES constant)
  const newBalance = parseFloat((Number(wallet.balance ?? 0) + usdAmount).toFixed(4));

  // Credit wallet via RPC (handles race conditions server-side)
  const { error: updateErr } = await supabase.rpc('add_to_wallet', {
    p_user_id: wallet.user_id,
    p_amount: usdAmount,
  });

  // Update the STK transaction record to completed
  await supabase
    .from('mpesa_transactions')
    .update({
      status: 'completed',
      mpesa_receipt_number: receipt || null,
      result_code: String(callback.ResultCode),
      result_desc: callback.ResultDesc,
    })
    .eq('checkout_request_id', callback.CheckoutRequestID);

  // Log wallet transaction
  await supabase.from('wallet_transactions').insert({
    wallet_id: wallet.id,
    user_id: wallet.user_id,
    type: 'deposit',
    amount: usdAmount,
    payment_method: 'mpesa',
    status: 'completed',
    reference: receipt || callback.CheckoutRequestID,
    description: `M-Pesa deposit — KES ${amount.toLocaleString()} (receipt: ${receipt || 'N/A'})`,
  });

  // Inbox notification
  await supabase.from('platform_inbox').insert({
    user_id: wallet.user_id,
    subject: `M-Pesa deposit confirmed: KES ${amount.toLocaleString()}`,
    body: `Your wallet has been credited with $${usdAmount.toFixed(2)} (KES ${amount.toLocaleString()}). Receipt: ${receipt || 'N/A'}.`,
    type: 'payment',
    icon_emoji: '✅',
    cta_label: 'View Wallet',
    cta_url: '/wallet',
  });

  console.log('[mpesaWebhook] Wallet credited:', { userId: wallet.user_id, usdAmount, receipt });

  if (updateErr) {
    console.warn('[mpesaWebhook] RPC error (non-fatal):', (updateErr as Error).message);
  }

  return {
    status: 'success',
    credited: usdAmount,
    newBalance,
  };
}
