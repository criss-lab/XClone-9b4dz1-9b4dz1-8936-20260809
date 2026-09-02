-- Atomic/idempotent wallet deposit primitive. Keep all money movement in SQL
-- so a retry cannot credit the wallet twice.
create or replace function public.credit_wallet_deposit(
  p_user_id uuid,
  p_amount numeric,
  p_currency text default 'USD',
  p_amount_kes numeric default null,
  p_fx_rate numeric default null,
  p_provider text default null,
  p_provider_transaction_id text default null,
  p_idempotency_key text default null,
  p_reference text default null,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_tx public.wallet_transactions; v_wallet public.user_wallets;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_idempotency_key is not null then
    select * into v_tx from public.wallet_transactions where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
    if found then return v_tx.id; end if;
  end if;
  if p_provider is not null and p_provider_transaction_id is not null then
    select * into v_tx from public.wallet_transactions where provider=p_provider and provider_transaction_id=p_provider_transaction_id for update;
    if found then return v_tx.id; end if;
  end if;
  insert into public.user_wallets(user_id,currency) values(p_user_id,coalesce(p_currency,'USD')) on conflict(user_id) do nothing;
  select * into v_wallet from public.user_wallets where user_id=p_user_id for update;
  update public.user_wallets set balance=balance+p_amount,updated_at=now() where id=v_wallet.id;
  insert into public.wallet_transactions(wallet_id,user_id,type,amount,currency,amount_kes,fx_rate,status,payment_method,provider,provider_transaction_id,idempotency_key,reference,description,metadata)
  values(v_wallet.id,p_user_id,'deposit',p_amount,coalesce(p_currency,'USD'),p_amount_kes,p_fx_rate,'completed',p_provider,p_provider,p_provider_transaction_id,p_idempotency_key,p_reference,p_description,coalesce(p_metadata,'{}'::jsonb)) returning * into v_tx;
  return v_tx.id;
end;
$$;

revoke all on function public.credit_wallet_deposit(uuid,numeric,text,numeric,numeric,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.credit_wallet_deposit(uuid,numeric,text,numeric,numeric,text,text,text,text,text,jsonb) to service_role;
