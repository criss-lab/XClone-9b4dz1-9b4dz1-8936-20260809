-- Phase 1 database regression tests. Run in an isolated test database.
-- Wrapped in a transaction so all test mutations are rolled back.

begin;

DO $$
declare
  u uuid;
  credit_id uuid;
  credit_id_2 uuid;
  reserve_id uuid;
  reserve_id_2 uuid;
  original_tx uuid;
  refund_id uuid;
  refund_id_2 uuid;
  bal numeric;
  reserved numeric;
begin
  select id into u from auth.users limit 1;
  if u is null then
    raise notice 'PHASE1 financial tests skipped: no auth.users fixture';
    return;
  end if;

  insert into public.user_wallets(user_id,balance,reserved_balance,currency)
  values(u,0,0,'USD')
  on conflict(user_id) do update set balance=0,reserved_balance=0,currency='USD';

  credit_id := public.credit_wallet_deposit(u,100,'USD',130,130,'test','provider-deposit-1','test:deposit:1','test deposit','phase1 test','{"test":true}');
  credit_id_2 := public.credit_wallet_deposit(u,100,'USD',130,130,'test','provider-deposit-1','test:deposit:1','test deposit','phase1 test','{"test":true}');
  if credit_id <> credit_id_2 then raise exception 'deposit idempotency failed'; end if;
  select balance,reserved_balance into bal,reserved from public.user_wallets where user_id=u;
  if bal <> 100 or reserved <> 0 then raise exception 'unexpected deposit balance: %, %',bal,reserved; end if;

  reserve_id := public.reserve_wallet_funds(u,40,'test:withdrawal:1');
  reserve_id_2 := public.reserve_wallet_funds(u,40,'test:withdrawal:1');
  if reserve_id <> reserve_id_2 then raise exception 'reservation idempotency failed'; end if;
  if (select balance-reserved_balance from public.user_wallets where user_id=u) <> 60 then raise exception 'available balance after reservation is wrong'; end if;

  begin
    perform public.reserve_wallet_funds(u,61,'test:withdrawal:2');
    raise exception 'insufficient funds reservation unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Insufficient available balance%' then raise; end if;
  end;

  perform public.release_wallet_reservation(reserve_id,'phase1 release test');
  if (select reserved_balance from public.user_wallets where user_id=u) <> 0 then raise exception 'reservation release failed'; end if;

  reserve_id := public.reserve_wallet_funds(u,25,'test:withdrawal:3');
  perform public.finalize_wallet_withdrawal(reserve_id);
  select balance,reserved_balance into bal,reserved from public.user_wallets where user_id=u;
  if bal <> 75 or reserved <> 0 then raise exception 'finalization produced wrong balances: %, %',bal,reserved; end if;

  perform public.post_creator_earning_atomic(u,5,'video_fund','video-test-1','USD',null,'{"test":true}');
  if (select count(*) from public.creator_earning_postings where user_id=u and source='video_fund' and source_id='video-test-1') <> 1 then raise exception 'creator posting missing'; end if;
  perform public.post_creator_earning_atomic(u,5,'video_fund','video-test-1','USD',null,'{"test":true}');
  if (select count(*) from public.creator_earning_postings where user_id=u and source='video_fund' and source_id='video-test-1') <> 1 then raise exception 'creator idempotency failed'; end if;

  perform public.post_ad_revenue_atomic(u,4,current_date,current_date,100,1000,10,'USD');
  perform public.post_ad_revenue_atomic(u,4,current_date,current_date,100,1000,10,'USD');
  if (select count(*) from public.ad_revenue_distributions where user_id=u and period_start=current_date and period_end=current_date) <> 1 then raise exception 'ad distribution idempotency failed'; end if;

  select id into original_tx from public.wallet_transactions where user_id=u and type='creator_earning' and idempotency_key='creator:video_fund:video-test-1' limit 1;
  refund_id := public.issue_wallet_refund(original_tx,u,5,'phase1 test refund','test:refund:1','USD');
  refund_id_2 := public.issue_wallet_refund(original_tx,u,5,'phase1 test refund','test:refund:1','USD');
  if refund_id <> refund_id_2 then raise exception 'refund idempotency failed'; end if;

  if (select reserved_balance from public.user_wallets where user_id=u) <> 0 then raise exception 'reserved balance leaked'; end if;
  raise notice 'PHASE1 financial regression tests passed';
end $$;

rollback;
