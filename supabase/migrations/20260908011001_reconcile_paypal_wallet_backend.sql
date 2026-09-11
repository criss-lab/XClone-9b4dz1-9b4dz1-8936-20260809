begin;
drop function if exists public.credit_wallet_paypal(uuid,text,text,numeric,text,jsonb);
create function public.credit_wallet_paypal(
  p_user_id uuid,p_paypal_order_id text,p_paypal_capture_id text,p_amount numeric,p_currency text,p_metadata jsonb default '{}'::jsonb
)
returns public.wallets language plpgsql security definer set search_path=public as $$
declare o public.paypal_orders; w public.wallets;
begin
  select * into o from public.paypal_orders where order_id=p_paypal_order_id for update;
  if not found then raise exception 'PAYPAL_ORDER_NOT_FOUND'; end if;
  if o.user_id<>p_user_id then raise exception 'PAYPAL_ORDER_FORBIDDEN'; end if;
  if o.amount<>round(p_amount::numeric,2) or o.currency<>upper(p_currency) then raise exception 'PAYPAL_AMOUNT_MISMATCH'; end if;
  if o.capture_id is not null then select * into w from public.wallets where id=o.wallet_id; return w; end if;
  return public.credit_wallet_from_paypal(p_paypal_order_id,p_paypal_capture_id,round(p_amount::numeric,2),upper(p_currency),'COMPLETED',coalesce(p_metadata,'{}'::jsonb));
end; $$;
revoke all on function public.credit_wallet_paypal(uuid,text,text,numeric,text,jsonb) from public;
grant execute on function public.credit_wallet_paypal(uuid,text,text,numeric,text,jsonb) to service_role;
commit;
