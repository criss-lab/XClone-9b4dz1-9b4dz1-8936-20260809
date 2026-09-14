begin;
-- The production database already has the legacy wallets/transactions tables.
-- Extend that schema instead of introducing a second wallet_accounts model.
alter table if exists public.wallets
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists total_deposited numeric not null default 0,
  add column if not exists total_withdrawn numeric not null default 0;
create unique index if not exists wallets_id_uidx on public.wallets(id);
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id text not null, type text not null default 'deposit', direction text not null default 'credit',
  amount numeric(20,2) not null check (amount > 0), currency text not null default 'USD', status text not null default 'pending',
  provider text, provider_reference text, provider_status text, payment_method text, description text not null default '',
  metadata jsonb not null default '{}'::jsonb, balance_before numeric(20,2), balance_after numeric(20,2),
  created_at timestamptz not null default now(), completed_at timestamptz
);
alter table if exists public.wallet_transactions
  add column if not exists id uuid default gen_random_uuid(), add column if not exists wallet_id uuid, add column if not exists user_id text,
  add column if not exists type text not null default 'deposit', add column if not exists direction text not null default 'credit',
  add column if not exists amount numeric(20,2), add column if not exists currency text not null default 'USD',
  add column if not exists status text not null default 'pending', add column if not exists provider text,
  add column if not exists provider_reference text, add column if not exists provider_status text, add column if not exists payment_method text,
  add column if not exists description text not null default '', add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists balance_before numeric(20,2), add column if not exists balance_after numeric(20,2),
  add column if not exists created_at timestamptz not null default now(), add column if not exists completed_at timestamptz;
create unique index if not exists wallet_transactions_id_uidx on public.wallet_transactions(id);
create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id, created_at desc);
create unique index if not exists wallet_transactions_provider_ref_uidx on public.wallet_transactions(provider, provider_reference) where provider is not null and provider_reference is not null;
create table if not exists public.paypal_orders (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null, transaction_id uuid references public.transactions(id) on delete set null,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null, paypal_order_id text unique, order_id text unique,
  amount numeric(20,2), amount_cents bigint, currency text not null default 'USD', status text not null default 'created', approval_url text,
  capture_id text, paypal_capture_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  captured_at timestamptz, updated_at timestamptz not null default now()
);
-- Reconcile the legacy PayPal table before adding indexes or foreign keys that depend on canonical identity.
alter table if exists public.paypal_orders add column if not exists id uuid default gen_random_uuid();
create unique index if not exists paypal_orders_id_uidx on public.paypal_orders(id);
alter table if exists public.paypal_orders
  add column if not exists wallet_id uuid references public.wallets(id) on delete set null,
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null,
  add column if not exists wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  add column if not exists paypal_order_id text, add column if not exists order_id text, add column if not exists amount numeric(20,2),
  add column if not exists amount_cents bigint, add column if not exists currency text not null default 'USD',
  add column if not exists status text not null default 'created', add column if not exists approval_url text,
  add column if not exists capture_id text, add column if not exists paypal_capture_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb, add column if not exists captured_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists paypal_orders_user_created_idx on public.paypal_orders(user_id, created_at desc);
create unique index if not exists paypal_orders_capture_id_key on public.paypal_orders(capture_id) where capture_id is not null;
create table if not exists public.paypal_webhook_events (
  id uuid primary key default gen_random_uuid(), event_id text not null unique, event_type text not null,
  paypal_order_id text, paypal_capture_id text, transmission_id text, payload jsonb not null, verified boolean not null default false,
  processed boolean not null default false, processing_error text, received_at timestamptz not null default now(), processed_at timestamptz
);
create index if not exists paypal_webhook_events_order_idx on public.paypal_webhook_events(paypal_order_id);
create or replace function public.sync_paypal_order_aliases() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.paypal_order_id is null then new.paypal_order_id := new.order_id; end if;
  if new.order_id is null then new.order_id := new.paypal_order_id; end if;
  if new.capture_id is null then new.capture_id := new.paypal_capture_id; end if;
  if new.paypal_capture_id is null then new.paypal_capture_id := new.capture_id; end if;
  if new.amount is null and new.amount_cents is not null then new.amount := new.amount_cents / 100.0; end if;
  if new.amount_cents is null and new.amount is not null then new.amount_cents := round(new.amount * 100)::bigint; end if;
  return new;
end; $$;
drop trigger if exists paypal_orders_alias_sync on public.paypal_orders;
create trigger paypal_orders_alias_sync before insert or update on public.paypal_orders for each row execute function public.sync_paypal_order_aliases();
create or replace function public.ensure_wallet(p_user_id uuid) returns public.wallets language plpgsql security definer set search_path = public as $$
declare v_wallet public.wallets;
begin
  if p_user_id is null then raise exception 'user_id_required' using errcode='22023'; end if;
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then raise exception 'not_authorized' using errcode='42501'; end if;
  insert into public.wallets(user_id,balance,currency) values(p_user_id::text,0,'USD') on conflict(user_id) do nothing;
  select * into v_wallet from public.wallets where user_id=p_user_id::text for update;
  if not found then raise exception 'wallet_provision_failed'; end if;
  return v_wallet;
end; $$;
-- PostgreSQL cannot change an existing function's return type with CREATE OR REPLACE.
-- The older production function returns public.transactions; this migration's canonical API returns jsonb.
drop function if exists public.finalize_paypal_topup(text,text);
create function public.finalize_paypal_topup(p_order_id text,p_capture_id text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.paypal_orders; v_tx public.wallet_transactions; v_wallet public.wallets; v_before numeric; v_after numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  if nullif(btrim(p_order_id),'') is null then raise exception 'order_id_required' using errcode='22023'; end if;
  if nullif(btrim(p_capture_id),'') is null then raise exception 'capture_id_required' using errcode='22023'; end if;
  select * into v_order from public.paypal_orders where coalesce(order_id,paypal_order_id)=p_order_id for update;
  if not found then raise exception 'paypal_order_not_found' using errcode='P0002'; end if;
  if coalesce(v_order.capture_id,v_order.paypal_capture_id) is not null then
    if coalesce(v_order.capture_id,v_order.paypal_capture_id) <> p_capture_id then raise exception 'capture_id_conflict' using errcode='23514'; end if;
    return jsonb_build_object('ok',true,'idempotent',true,'order_id',p_order_id,'capture_id',p_capture_id);
  end if;
  if v_order.wallet_transaction_id is null then raise exception 'paypal_order_missing_transaction'; end if;
  select * into v_tx from public.wallet_transactions where id=v_order.wallet_transaction_id for update;
  if not found then raise exception 'wallet_transaction_not_found' using errcode='P0002'; end if;
  if v_tx.status='completed' then
    update public.paypal_orders set capture_id=p_capture_id,paypal_capture_id=p_capture_id,status='captured',captured_at=coalesce(captured_at,now()),updated_at=now() where id=v_order.id;
    return jsonb_build_object('ok',true,'idempotent',true,'order_id',p_order_id,'capture_id',p_capture_id,'transaction_id',v_tx.id);
  end if;
  if v_tx.status <> 'pending' then raise exception 'wallet_transaction_not_pending' using errcode='23514'; end if;
  select * into v_wallet from public.wallets where id=v_tx.wallet_id and user_id=v_tx.user_id for update;
  if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;
  v_before := coalesce(v_wallet.balance,0); v_after := v_before + v_tx.amount;
  update public.wallets set balance=v_after,total_deposited=coalesce(total_deposited,0)+v_tx.amount,updated_at=now() where id=v_wallet.id;
  update public.wallet_transactions set status='completed',balance_before=v_before,balance_after=v_after,provider_status='COMPLETED',payment_method='paypal',completed_at=now() where id=v_tx.id;
  update public.paypal_orders set status='captured',capture_id=p_capture_id,paypal_capture_id=p_capture_id,captured_at=now(),updated_at=now() where id=v_order.id;
  return jsonb_build_object('ok',true,'idempotent',false,'order_id',p_order_id,'capture_id',p_capture_id,'transaction_id',v_tx.id,'wallet_id',v_wallet.id,'status','completed','amount',v_tx.amount,'currency',v_tx.currency,'balance_before',v_before,'balance_after',v_after);
end; $$;
revoke all on function public.ensure_wallet(uuid) from public;
grant execute on function public.ensure_wallet(uuid) to authenticated,service_role;
revoke all on function public.finalize_paypal_topup(text,text) from public,anon,authenticated;
grant execute on function public.finalize_paypal_topup(text,text) to service_role;
commit;
