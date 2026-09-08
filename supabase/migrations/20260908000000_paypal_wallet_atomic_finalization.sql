begin;

create unique index if not exists paypal_orders_order_id_key on public.paypal_orders(order_id);
create unique index if not exists paypal_orders_capture_id_key on public.paypal_orders(capture_id) where capture_id is not null;
create index if not exists paypal_orders_wallet_transaction_idx on public.paypal_orders(wallet_transaction_id);
create unique index if not exists wallet_transactions_provider_ref_uidx on public.wallet_transactions(provider, provider_reference) where provider is not null and provider_reference is not null;
create unique index if not exists paypal_webhook_events_event_id_key on public.paypal_webhook_events(event_id);

create or replace function public.ensure_wallet(p_user_id uuid)
returns public.wallets language plpgsql security definer set search_path = '' as $function$
declare v_wallet public.wallets;
begin
  if p_user_id is null then raise exception 'user_id_required' using errcode='22023'; end if;
  if current_user <> 'service_role' and auth.uid() is distinct from p_user_id then raise exception 'not_authorized' using errcode='42501'; end if;
  insert into public.wallets(user_id,balance,currency) values(p_user_id,0,'USD') on conflict(user_id) do nothing;
  select w.* into v_wallet from public.wallets w where w.user_id=p_user_id for update;
  if not found then raise exception 'wallet_provision_failed'; end if;
  return v_wallet;
end;
$function$;

create or replace function public.finalize_paypal_topup(p_order_id text,p_capture_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_order public.paypal_orders; v_tx public.wallet_transactions; v_wallet public.wallets; v_before numeric; v_after numeric;
begin
  if current_user <> 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  if nullif(btrim(p_order_id),'') is null then raise exception 'order_id_required' using errcode='22023'; end if;
  if nullif(btrim(p_capture_id),'') is null then raise exception 'capture_id_required' using errcode='22023'; end if;
  select * into v_order from public.paypal_orders where order_id=p_order_id for update;
  if not found then raise exception 'paypal_order_not_found' using errcode='P0002'; end if;
  if v_order.status='captured' then
    if v_order.capture_id is distinct from p_capture_id then raise exception 'capture_id_conflict' using errcode='23514'; end if;
    select * into v_tx from public.wallet_transactions where id=v_order.wallet_transaction_id;
    if not found then raise exception 'captured_transaction_not_found' using errcode='P0002'; end if;
    return jsonb_build_object('ok',true,'idempotent',true,'order_id',p_order_id,'capture_id',p_capture_id,'transaction_id',v_tx.id,'wallet_id',v_tx.wallet_id,'status',v_tx.status,'amount',v_tx.amount,'currency',v_tx.currency);
  end if;
  if v_order.wallet_transaction_id is null then raise exception 'paypal_order_missing_transaction'; end if;
  select * into v_tx from public.wallet_transactions where id=v_order.wallet_transaction_id for update;
  if not found then raise exception 'wallet_transaction_not_found' using errcode='P0002'; end if;
  if v_tx.user_id is distinct from v_order.user_id or v_tx.wallet_id is distinct from v_order.wallet_id or v_tx.provider is distinct from 'paypal' or v_tx.provider_reference is distinct from p_order_id then raise exception 'paypal_transaction_binding_mismatch' using errcode='23514'; end if;
  if v_tx.type <> 'deposit' then raise exception 'invalid_paypal_transaction_type' using errcode='23514'; end if;
  if v_tx.status='completed' then
    update public.paypal_orders set status='captured',capture_id=p_capture_id,captured_at=coalesce(captured_at,now()),updated_at=now() where id=v_order.id;
    return jsonb_build_object('ok',true,'idempotent',true,'order_id',p_order_id,'capture_id',p_capture_id,'transaction_id',v_tx.id,'wallet_id',v_tx.wallet_id,'status',v_tx.status,'amount',v_tx.amount,'currency',v_tx.currency);
  end if;
  if v_tx.status <> 'pending' then raise exception 'wallet_transaction_not_pending' using errcode='23514'; end if;
  if v_order.amount <> v_tx.amount or upper(v_order.currency) <> upper(v_tx.currency) then raise exception 'paypal_amount_currency_mismatch' using errcode='23514'; end if;
  select * into v_wallet from public.wallets where id=v_tx.wallet_id and user_id=v_tx.user_id for update;
  if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;
  v_before:=coalesce(v_wallet.balance,0); v_after:=v_before+v_tx.amount;
  update public.wallets set balance=v_after,total_deposited=coalesce(total_deposited,0)+v_tx.amount,updated_at=now() where id=v_wallet.id;
  update public.wallet_transactions set status='completed',balance_before=v_before,balance_after=v_after,provider_status='COMPLETED',payment_method='paypal',completed_at=now() where id=v_tx.id;
  update public.paypal_orders set status='captured',capture_id=p_capture_id,captured_at=now(),updated_at=now() where id=v_order.id;
  return jsonb_build_object('ok',true,'idempotent',false,'order_id',p_order_id,'capture_id',p_capture_id,'transaction_id',v_tx.id,'wallet_id',v_wallet.id,'status','completed','amount',v_tx.amount,'currency',v_tx.currency,'balance_before',v_before,'balance_after',v_after);
end;
$function$;

revoke all on function public.ensure_wallet(uuid) from public;
revoke all on function public.finalize_paypal_topup(text,text) from public;
grant execute on function public.ensure_wallet(uuid) to authenticated,service_role;
grant execute on function public.finalize_paypal_topup(text,text) to service_role;
commit;
