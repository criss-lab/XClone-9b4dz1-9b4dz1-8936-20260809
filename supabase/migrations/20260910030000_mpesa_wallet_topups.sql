create table if not exists public.mpesa_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  merchant_request_id text,
  checkout_request_id text not null unique,
  amount_kes numeric(18,2) not null check (amount_kes > 0),
  wallet_amount numeric(18,2) not null check (wallet_amount > 0),
  wallet_currency text not null default 'USD',
  phone text not null,
  status text not null default 'pending' check (status in ('pending','completed','failed','cancelled')),
  result_code integer,
  result_description text,
  receipt_number text,
  raw_response jsonb not null default '{}'::jsonb,
  callback_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists mpesa_payments_user_created_idx on public.mpesa_payments(user_id, created_at desc);
create unique index if not exists mpesa_payments_receipt_idx on public.mpesa_payments(receipt_number) where receipt_number is not null;

alter table public.mpesa_payments enable row level security;
drop policy if exists mpesa_payments_read_own on public.mpesa_payments;
create policy mpesa_payments_read_own on public.mpesa_payments for select to authenticated using (user_id = auth.uid());

create or replace function public.finalize_mpesa_topup(
  p_checkout_request_id text,
  p_result_code integer,
  p_receipt_number text default null,
  p_result_description text default null,
  p_callback_data jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_payment public.mpesa_payments;
  v_tx public.wallet_transactions;
  v_wallet public.wallets;
  v_before numeric;
  v_after numeric;
  v_amount_cents bigint;
  v_currency text;
begin
  if auth.role() <> 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  if nullif(btrim(p_checkout_request_id), '') is null then raise exception 'checkout_request_id_required' using errcode='22023'; end if;

  select * into v_payment from public.mpesa_payments where checkout_request_id = p_checkout_request_id for update;
  if not found then raise exception 'mpesa_payment_not_found' using errcode='P0002'; end if;

  if p_result_code <> 0 then
    update public.mpesa_payments
      set status='failed', result_code=p_result_code, result_description=p_result_description,
          callback_data=coalesce(p_callback_data,'{}'::jsonb), updated_at=now()
      where id=v_payment.id and status='pending';
    update public.wallet_transactions
      set status='failed', provider_status=coalesce(p_result_description, 'M-Pesa payment failed'),
          metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('mpesa_result_code',p_result_code)
      where id=v_payment.wallet_transaction_id and status='pending';
    return jsonb_build_object('ok',true,'status','failed','checkout_request_id',p_checkout_request_id,'result_code',p_result_code);
  end if;

  if v_payment.status='completed' then
    return jsonb_build_object('ok',true,'idempotent',true,'status','completed','checkout_request_id',p_checkout_request_id,'receipt_number',coalesce(v_payment.receipt_number,p_receipt_number));
  end if;
  if v_payment.status<>'pending' then raise exception 'mpesa_payment_not_pending' using errcode='23514'; end if;

  select * into v_tx from public.wallet_transactions where id=v_payment.wallet_transaction_id for update;
  if not found then raise exception 'wallet_transaction_not_found' using errcode='P0002'; end if;
  if v_tx.status='completed' then
    update public.mpesa_payments set status='completed',result_code=0,receipt_number=coalesce(receipt_number,p_receipt_number),result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),completed_at=coalesce(completed_at,now()),updated_at=now() where id=v_payment.id;
    return jsonb_build_object('ok',true,'idempotent',true,'status','completed','checkout_request_id',p_checkout_request_id);
  end if;
  if v_tx.status<>'pending' then raise exception 'wallet_transaction_not_pending' using errcode='23514'; end if;

  select * into v_wallet from public.wallets where id=v_payment.wallet_id and user_id=v_payment.user_id for update;
  if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;

  v_before:=coalesce(v_wallet.balance,0);
  v_after:=v_before+v_tx.amount;
  update public.wallets set balance=v_after,total_deposited=coalesce(total_deposited,0)+v_tx.amount,updated_at=now() where id=v_wallet.id;
  update public.wallet_transactions set status='completed',balance_before=v_before,balance_after=v_after,provider_status='COMPLETED',payment_method='mpesa',provider_capture_id=coalesce(p_receipt_number,provider_capture_id),completed_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('mpesa_checkout_request_id',p_checkout_request_id,'mpesa_receipt_number',p_receipt_number) where id=v_tx.id;
  update public.mpesa_payments set status='completed',result_code=0,receipt_number=coalesce(p_receipt_number,receipt_number),result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),completed_at=now(),updated_at=now() where id=v_payment.id;

  v_amount_cents:=round(v_tx.amount*100); v_currency:=upper(coalesce(v_tx.currency,'USD'));
  insert into public.monetization_accounts(user_id,currency) values(v_payment.user_id,v_currency) on conflict(user_id) do nothing;
  insert into public.monetization_ledger(account_user_id,entry_type,direction,amount_cents,currency,state,gross_cents,platform_fee_cents,creator_share_bps,provider,provider_event_id,provider_reference,idempotency_key,source_type,source_id,description,metadata,available_at,settled_at)
  values(v_payment.user_id,'topup','credit',v_amount_cents,v_currency,'available',v_amount_cents,0,10000,'mpesa',coalesce(p_receipt_number,p_checkout_request_id),p_checkout_request_id,'mpesa-topup:'||p_checkout_request_id,'mpesa_payment',p_checkout_request_id,'M-Pesa wallet top-up',jsonb_build_object('wallet_transaction_id',v_tx.id,'amount_kes',v_payment.amount_kes),now(),now())
  on conflict (account_user_id,idempotency_key) where idempotency_key is not null do nothing;
  update public.monetization_accounts set available_cents=available_cents+v_amount_cents,updated_at=now() where user_id=v_payment.user_id;

  return jsonb_build_object('ok',true,'idempotent',false,'status','completed','checkout_request_id',p_checkout_request_id,'receipt_number',p_receipt_number,'wallet_id',v_wallet.id,'balance_before',v_before,'balance_after',v_after,'amount',v_tx.amount,'currency',v_tx.currency);
end;
$$;

revoke all on function public.finalize_mpesa_topup(text,integer,text,text,jsonb) from public;
