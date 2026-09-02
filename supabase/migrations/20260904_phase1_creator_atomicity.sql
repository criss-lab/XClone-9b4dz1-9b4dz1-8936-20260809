-- Creator/ad revenue must be one transaction: earning record + wallet credit + posting key.
create or replace function public.post_creator_earning_atomic(p_user_id uuid,p_amount numeric,p_source text,p_source_id text,p_currency text default 'USD',p_post_id uuid default null,p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_existing uuid; v_wallet public.user_wallets; v_tx public.wallet_transactions; v_creator_earning uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  select wallet_transaction_id into v_existing from public.creator_earning_postings where source=p_source and source_id=p_source_id and user_id=p_user_id;
  if v_existing is not null then return v_existing; end if;
  if to_regclass('public.creator_earnings') is not null then
    if p_post_id is not null then execute 'insert into public.creator_earnings(user_id,source,amount,post_id,status) values ($1,$2,$3,$4,$5) returning id' into v_creator_earning using p_user_id,p_source,p_amount,p_post_id,'completed';
    else execute 'insert into public.creator_earnings(user_id,source,amount,status) values ($1,$2,$3,$4) returning id' into v_creator_earning using p_user_id,p_source,p_amount,'completed'; end if;
  end if;
  select * into v_wallet from public.user_wallets where user_id=p_user_id for update;
  if not found then insert into public.user_wallets(user_id,currency) values(p_user_id,p_currency) returning * into v_wallet; end if;
  update public.user_wallets set balance=balance+p_amount,updated_at=now() where id=v_wallet.id;
  insert into public.wallet_transactions(wallet_id,user_id,type,amount,currency,status,idempotency_key,metadata)
  values(v_wallet.id,p_user_id,'creator_earning',p_amount,p_currency,'completed','creator:'||p_source||':'||p_source_id,coalesce(p_metadata,'{}'::jsonb)) returning * into v_tx;
  insert into public.creator_earning_postings(source,source_id,user_id,amount,currency,wallet_transaction_id,creator_earning_id)
  values(p_source,p_source_id,p_user_id,p_amount,p_currency,v_tx.id,v_creator_earning);
  return v_tx.id;
end;
$$;

create or replace function public.post_ad_revenue_atomic(p_user_id uuid,p_amount numeric,p_period_start date,p_period_end date,p_views bigint,p_total_views bigint,p_gross_revenue numeric,p_currency text default 'USD')
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_existing uuid; v_wallet public.user_wallets; v_tx public.wallet_transactions;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  select wallet_transaction_id into v_existing from public.ad_revenue_distributions where period_start=p_period_start and period_end=p_period_end and user_id=p_user_id;
  if v_existing is not null then return v_existing; end if;
  select * into v_wallet from public.user_wallets where user_id=p_user_id for update;
  if not found then insert into public.user_wallets(user_id,currency) values(p_user_id,p_currency) returning * into v_wallet; end if;
  update public.user_wallets set balance=balance+p_amount,updated_at=now() where id=v_wallet.id;
  insert into public.wallet_transactions(wallet_id,user_id,type,amount,currency,status,idempotency_key,metadata)
  values(v_wallet.id,p_user_id,'ad_revenue_share',p_amount,p_currency,'completed','ad:'||p_period_start||':'||p_period_end||':'||p_user_id,jsonb_build_object('period_start',p_period_start,'period_end',p_period_end)) returning * into v_tx;
  insert into public.ad_revenue_distributions(period_start,period_end,user_id,views,total_views,gross_revenue,creator_share,currency,wallet_transaction_id)
  values(p_period_start,p_period_end,p_user_id,p_views,p_total_views,p_gross_revenue,p_amount,p_currency,v_tx.id);
  return v_tx.id;
end;
$$;

revoke all on function public.post_creator_earning_atomic(uuid,numeric,text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.post_ad_revenue_atomic(uuid,numeric,date,date,bigint,bigint,numeric,text) from public,anon,authenticated;
grant execute on function public.post_creator_earning_atomic(uuid,numeric,text,text,text,uuid,jsonb) to service_role;
grant execute on function public.post_ad_revenue_atomic(uuid,numeric,date,date,bigint,bigint,numeric,text) to service_role;
