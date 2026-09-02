-- Refunds are idempotent and capped at the original transaction value.
create or replace function public.issue_wallet_refund(p_original_transaction_id uuid,p_user_id uuid,p_amount numeric,p_reason text,p_idempotency_key text,p_currency text default 'USD')
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_existing uuid; v_original public.wallet_transactions; v_wallet public.user_wallets; v_tx public.wallet_transactions; v_refunded numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  select refund_transaction_id into v_existing from public.refund_transactions where idempotency_key=p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select * into v_original from public.wallet_transactions where id=p_original_transaction_id and user_id=p_user_id for update;
  if not found then raise exception 'Original transaction not found'; end if;
  if v_original.amount <= 0 then raise exception 'Only positive transactions can be refunded'; end if;
  if p_currency <> v_original.currency then raise exception 'Refund currency mismatch'; end if;
  select coalesce(sum(amount),0) into v_refunded from public.refund_transactions where original_transaction_id=p_original_transaction_id and status='completed';
  if v_refunded+p_amount > v_original.amount then raise exception 'Refund exceeds refundable amount'; end if;
  select * into v_wallet from public.user_wallets where user_id=p_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  update public.user_wallets set balance=balance+p_amount,updated_at=now() where id=v_wallet.id;
  insert into public.wallet_transactions(wallet_id,user_id,type,amount,currency,status,idempotency_key,reference,description,metadata)
  values(v_wallet.id,p_user_id,'refund',p_amount,p_currency,'completed','refund:'||p_idempotency_key,p_original_transaction_id::text,p_reason,jsonb_build_object('original_transaction_id',p_original_transaction_id)) returning * into v_tx;
  insert into public.refund_transactions(original_transaction_id,user_id,amount,currency,reason,idempotency_key,refund_transaction_id)
  values(p_original_transaction_id,p_user_id,p_amount,p_currency,p_reason,p_idempotency_key,v_tx.id);
  return v_tx.id;
end;
$$;
revoke all on function public.issue_wallet_refund(uuid,uuid,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.issue_wallet_refund(uuid,uuid,numeric,text,text,text) to service_role;
