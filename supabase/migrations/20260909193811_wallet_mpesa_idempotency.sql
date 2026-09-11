create or replace function public.reserve_wallet_withdrawal_idempotent(
  p_user_id uuid,
  p_amount numeric,
  p_currency text,
  p_payment_method text,
  p_provider text,
  p_provider_reference text,
  p_idempotency_key text,
  p_description text,
  p_metadata jsonb default '{}'::jsonb
) returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets;
  tx public.wallet_transactions;
  b numeric;
  existing public.wallet_transactions;
begin
  if p_user_id is null or p_amount <= 0 then raise exception 'INVALID_WITHDRAWAL'; end if;
  if p_provider <> 'mpesa' then raise exception 'UNSUPPORTED_PROVIDER'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 12 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id and not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;

  select * into existing
  from public.wallet_transactions
  where user_id = p_user_id
    and provider = p_provider
    and type = 'withdrawal'
    and coalesce(metadata->>'idempotency_key','') = p_idempotency_key
  order by created_at desc
  limit 1
  for update;
  if found then return existing; end if;

  select * into w from public.wallets where user_id=p_user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if w.status <> 'active' or not w.withdrawals_enabled then raise exception 'WITHDRAWALS_DISABLED'; end if;
  if w.currency <> p_currency or w.balance < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;

  b := w.balance;
  update public.wallets set balance=balance-p_amount, updated_at=now() where id=w.id;
  insert into public.wallet_transactions(
    wallet_id,user_id,type,status,amount,currency,balance_before,balance_after,
    provider,provider_reference,description,metadata,payment_method,reference
  ) values (
    w.id,p_user_id,'withdrawal','pending',p_amount,p_currency,b,b-p_amount,
    p_provider,p_provider_reference,p_description,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('idempotency_key',p_idempotency_key),
    p_payment_method,p_provider_reference
  ) returning * into tx;
  return tx;
end;
$$;

revoke all on function public.reserve_wallet_withdrawal_idempotent(uuid,numeric,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_wallet_withdrawal_idempotent(uuid,numeric,text,text,text,text,text,text,jsonb) to authenticated, service_role;
