import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const cronSecret = Deno.env.get('PAYMENT_RECONCILIATION_SECRET') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_not_configured' }, 500);

  const auth = req.headers.get('authorization') ?? '';
  const suppliedSecret = req.headers.get('x-reconciliation-secret') ?? '';
  const isTrustedCron = cronSecret.length > 0 && suppliedSecret === cronSecret;
  if (!isTrustedCron && !auth.toLowerCase().startsWith('bearer ')) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (!isTrustedCron) {
    const token = auth.slice(7);
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) return json({ error: 'unauthorized' }, 401);
    const role = user.app_metadata?.role;
    if (role !== 'admin' && role !== 'super_admin') return json({ error: 'forbidden' }, 403);
  }

  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: staleWithdrawals, error: withdrawalError } = await admin
    .from('withdrawal_requests')
    .select('id,user_id,amount,currency,payout_currency,status,provider,provider_transaction_id,created_at')
    .in('status', ['pending', 'processing'])
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(200);

  if (withdrawalError) return json({ error: withdrawalError.message }, 500);

  let flagged = 0;
  for (const withdrawal of staleWithdrawals ?? []) {
    // Do not guess an external provider outcome. Flag the transaction for provider
    // status lookup/retry instead of inventing a success/failure result.
    const payloadHash = `${withdrawal.id}:${withdrawal.status}:${withdrawal.provider_transaction_id ?? ''}`;
    const { error } = await admin.from('payment_reconciliation_events').upsert({
      provider: withdrawal.provider ?? 'unknown',
      provider_transaction_id: withdrawal.provider_transaction_id ?? withdrawal.id,
      event_type: 'stale_withdrawal',
      expected_status: withdrawal.status,
      observed_status: 'stale',
      payload_hash: payloadHash,
      payload: { withdrawal_id: withdrawal.id, age_minutes: Math.floor((Date.now() - new Date(withdrawal.created_at).getTime()) / 60000) },
      resolved: false,
    }, { onConflict: 'provider,provider_transaction_id,event_type,payload_hash' });
    if (!error) flagged++;
  }

  const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: stuckIdempotency } = await admin
    .from('payment_idempotency')
    .select('id,operation,idempotency_key,created_at')
    .eq('status', 'processing')
    .lt('created_at', staleBefore)
    .limit(200);

  // A stale processing record is not silently changed to success. It is marked
  // failed so a caller can safely retry with the same key.
  let released = 0;
  for (const item of stuckIdempotency ?? []) {
    const { error } = await admin.from('payment_idempotency').update({
      status: 'failed',
      response: { error: 'stale_processing_record', retryable: true },
      completed_at: new Date().toISOString(),
    }).eq('id', item.id).eq('status', 'processing');
    if (!error) released++;
  }

  await admin.from('audit_logs').insert({
    action: 'payment_reconciliation_run',
    entity_type: 'payment_reconciliation',
    metadata: { flagged_stale_withdrawals: flagged, released_stale_idempotency: released },
  });

  return json({ ok: true, flagged_stale_withdrawals: flagged, released_stale_idempotency: released });
});
