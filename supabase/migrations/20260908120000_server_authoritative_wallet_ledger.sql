begin;
create or replace function public.credit_wallet_deposit(p_user_id uuid,p_amount numeric,p_currency text default 'USD',p_provider text default 'mpesa',p_provider_reference text default null,p_provider_status text default 'COMPLETED',p_payment_method text default 'mpesa',p_description text default null,p_metadata jsonb default '{}'::jsonb)
returns public.wallet_transactions language plpgsql security definer set search_path='public' as $$
declare w public.wallets; tx public.wallet_transactions; before_balance numeric; clean_amount numeric;
begin
 if auth.uid() is not null then raise exception 'SERVER_ONLY'; end if;
 clean_amount:=round(coalesce(p_amount,0),2);
 if p_user_id is null then raise exception 'INVALID_USER'; end if;
 if clean_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
 if upper(coalesce(p_currency,'USD'))<>'USD' then raise exception 'UNSUPPORTED_CURRENCY'; end if;
 if p_provider_reference is not null then
   select * into tx from public.wallet_transactions where provider=p_provider and provider_reference=p_provider_reference for update;
   if found then return tx; end if;
 end if;
 select * into w from public.wallets where user_id=p_user_id for update;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 before_balance:=coalesce(w.balance,0);
 insert into public.wallet_transactions(wallet_id,user_id,type,status,amount,currency,balance_before,balance_after,provider,provider_reference,provider_status,description,metadata,payment_method,completed_at)
 values(w.id,p_user_id,'deposit','completed',clean_amount,'USD',before_balance,before_balance+clean_amount,p_provider,p_provider_reference,p_provider_status,coalesce(p_description,'Wallet deposit'),coalesce(p_metadata,'{}'::jsonb),p_payment_method,now()) returning * into tx;
 update public.wallets set balance=before_balance+clean_amount,total_deposited=coalesce(total_deposited,0)+clean_amount,updated_at=now() where id=w.id;
 return tx;
end; $$;
grant execute on function public.credit_wallet_deposit(uuid,numeric,text,text,text,text,text,text,jsonb) to service_role;
revoke execute on function public.credit_wallet_deposit(uuid,numeric,text,text,text,text,text,text,jsonb) from anon,authenticated;
create or replace function public.reserve_wallet_withdrawal(p_user_id uuid,p_amount numeric,p_currency text default 'USD',p_payment_method text default 'mpesa',p_provider text default 'mpesa',p_provider_reference text default null,p_description text default null,p_metadata jsonb default '{}'::jsonb)
returns public.wallet_transactions language plpgsql security definer set search_path='public' as $$
declare w public.wallets; tx public.wallet_transactions; before_balance numeric; clean_amount numeric;
begin
 if auth.uid() is not null then raise exception 'SERVER_ONLY'; end if;
 if p_user_id is null then raise exception 'INVALID_USER'; end if;
 clean_amount:=round(coalesce(p_amount,0),2);
 if clean_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
 if upper(coalesce(p_currency,'USD'))<>'USD' then raise exception 'UNSUPPORTED_CURRENCY'; end if;
 select * into w from public.wallets where user_id=p_user_id for update;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 before_balance:=coalesce(w.balance,0);
 if before_balance<clean_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
 insert into public.wallet_transactions(wallet_id,user_id,type,status,amount,currency,balance_before,balance_after,provider,provider_reference,description,metadata,payment_method)
 values(w.id,p_user_id,'withdrawal','pending',clean_amount,'USD',before_balance,before_balance-clean_amount,p_provider,p_provider_reference,coalesce(p_description,'Wallet withdrawal'),coalesce(p_metadata,'{}'::jsonb),p_payment_method)
 returning * into tx;
 update public.wallets set balance=before_balance-clean_amount,updated_at=now() where id=w.id;
 return tx;
end; $$;
grant execute on function public.reserve_wallet_withdrawal(uuid,numeric,text,text,text,text,text,jsonb) to service_role;
revoke execute on function public.reserve_wallet_withdrawal(uuid,numeric,text,text,text,text,text,jsonb) from anon,authenticated;
create or replace function public.complete_wallet_withdrawal(p_transaction_id uuid,p_provider_reference text,p_provider_status text default 'COMPLETED')
returns public.wallet_transactions language plpgsql security definer set search_path='public' as $$
declare tx public.wallet_transactions;
begin
 if auth.uid() is not null then raise exception 'SERVER_ONLY'; end if;
 select * into tx from public.wallet_transactions where id=p_transaction_id for update;
 if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
 if tx.type<>'withdrawal' then raise exception 'INVALID_TRANSACTION_TYPE'; end if;
 if tx.status='completed' then return tx; end if;
 if tx.status<>'pending' then raise exception 'INVALID_TRANSACTION_STATUS'; end if;
 update public.wallet_transactions set status='completed',provider_reference=coalesce(p_provider_reference,provider_reference),provider_status=p_provider_status,completed_at=now() where id=tx.id returning * into tx;
 update public.wallets set total_withdrawn=coalesce(total_withdrawn,0)+tx.amount,updated_at=now() where id=tx.wallet_id;
 return tx;
end; $$;
grant execute on function public.complete_wallet_withdrawal(uuid,text,text) to service_role;
revoke execute on function public.complete_wallet_withdrawal(uuid,text,text) from anon,authenticated;
create or replace function public.fail_wallet_withdrawal(p_transaction_id uuid,p_provider_reference text default null,p_provider_status text default 'FAILED',p_reason text default null)
returns public.wallet_transactions language plpgsql security definer set search_path='public' as $$
declare tx public.wallet_transactions; w public.wallets; new_balance numeric;
begin
 if auth.uid() is not null then raise exception 'SERVER_ONLY'; end if;
 select * into tx from public.wallet_transactions where id=p_transaction_id for update;
 if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
 if tx.type<>'withdrawal' then raise exception 'INVALID_TRANSACTION_TYPE'; end if;
 if tx.status='failed' then return tx; end if;
 if tx.status<>'pending' then raise exception 'INVALID_TRANSACTION_STATUS'; end if;
 select * into w from public.wallets where id=tx.wallet_id for update;
 new_balance:=coalesce(w.balance,0)+tx.amount;
 update public.wallets set balance=new_balance,updated_at=now() where id=w.id;
 update public.wallet_transactions set status='failed',provider_reference=coalesce(p_provider_reference,provider_reference),provider_status=p_provider_status,balance_after=new_balance,description=coalesce(p_reason,description),completed_at=now() where id=tx.id returning * into tx;
 return tx;
end; $$;
grant execute on function public.fail_wallet_withdrawal(uuid,text,text,text) to service_role;
revoke execute on function public.fail_wallet_withdrawal(uuid,text,text,text) from anon,authenticated;
commit;
