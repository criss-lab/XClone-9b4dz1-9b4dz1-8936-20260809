begin;

create or replace function public.send_creator_tip(
  p_creator_id uuid,
  p_amount_cents bigint,
  p_idempotency_key text,
  p_message text default null
) returns public.monetization_ledger
language plpgsql security definer set search_path = ''
as $$
declare
  sender_id uuid := (select auth.uid());
  sender_wallet public.wallets;
  creator public.profiles;
  settings public.monetization_settings;
  existing public.monetization_ledger;
  earning public.monetization_ledger;
  debit_id uuid;
  creator_cents bigint;
  fee_cents bigint;
  currency text;
begin
  if sender_id is null then raise exception 'unauthorized'; end if;
  if p_creator_id is null or p_creator_id = sender_id then raise exception 'invalid recipient'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'invalid tip amount'; end if;
  if p_amount_cents > 10000000 then raise exception 'tip exceeds per-transaction limit'; end if;
  if nullif(trim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'idempotency key required'; end if;
  if length(p_idempotency_key) > 200 then raise exception 'idempotency key too long'; end if;

  select * into existing from public.monetization_ledger where account_user_id=p_creator_id and idempotency_key=p_idempotency_key;
  if found then return existing; end if;

  select * into creator from public.profiles where id=p_creator_id;
  if not found then raise exception 'creator not found'; end if;
  select * into settings from public.monetization_settings where id=true;
  if not coalesce(settings.tips_enabled,true) then raise exception 'tips are disabled'; end if;

  select * into sender_wallet from public.wallets where user_id=sender_id for update;
  if not found then raise exception 'wallet not found'; end if;
  if sender_wallet.status <> 'active' or not sender_wallet.spending_enabled then raise exception 'wallet spending disabled'; end if;
  if sender_wallet.currency <> 'USD' then raise exception 'tips currently require USD wallet'; end if;
  currency := sender_wallet.currency;
  if sender_wallet.balance_cents < p_amount_cents then raise exception 'insufficient wallet balance'; end if;

  creator_cents := floor((p_amount_cents * settings.creator_share_bps)::numeric / 10000);
  fee_cents := p_amount_cents - creator_cents;
  if creator_cents <= 0 then raise exception 'tip amount below minimum creator share'; end if;

  update public.wallets set balance_cents=balance_cents-p_amount_cents, updated_at=now() where id=sender_wallet.id;
  insert into public.wallet_transactions(wallet_id,user_id,kind,amount_cents,currency,direction,status,provider,description,metadata)
    values(sender_wallet.id,sender_id,'tip',p_amount_cents,currency,'debit','completed','internal','Tip to creator',jsonb_build_object('creator_id',p_creator_id,'idempotency_key',p_idempotency_key,'message',left(coalesce(p_message,''),500)))
    returning id into debit_id;

  insert into public.monetization_accounts(user_id,currency) values(p_creator_id,currency) on conflict(user_id) do nothing;
  insert into public.monetization_ledger(account_user_id,counterparty_user_id,entry_type,direction,amount_cents,currency,state,gross_cents,platform_fee_cents,creator_share_bps,provider,provider_reference,idempotency_key,source_type,source_id,description,metadata,available_at)
    values(p_creator_id,sender_id,'tip','credit',creator_cents,currency,'pending',p_amount_cents,fee_cents,settings.creator_share_bps,'internal_wallet',debit_id::text,p_idempotency_key,'wallet_tip',debit_id::text,'Creator tip',jsonb_build_object('sender_id',sender_id,'verified_tier',creator.verified_tier,'message',left(coalesce(p_message,''),500)),now()+make_interval(days=>settings.payout_hold_days))
    returning * into earning;

  update public.monetization_accounts set pending_cents=pending_cents+creator_cents,lifetime_earned_cents=lifetime_earned_cents+creator_cents,updated_at=now() where user_id=p_creator_id;
  return earning;
exception when unique_violation then
  select * into existing from public.monetization_ledger where account_user_id=p_creator_id and idempotency_key=p_idempotency_key;
  if found then return existing; end if;
  raise;
end;
$$;

revoke all on function public.send_creator_tip(uuid,bigint,text,text) from public;
grant execute on function public.send_creator_tip(uuid,bigint,text,text) to authenticated;
commit;
