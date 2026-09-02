-- Phase 1 authorization hardening. Runs after canonical wallet and financial primitives.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((auth.jwt()->'app_metadata'->>'role') in ('admin','super_admin'),false); $$;

revoke all on function public.add_to_wallet(uuid,numeric) from public,anon,authenticated;
revoke all on function public.reserve_wallet_funds(uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.release_wallet_reservation(uuid,text) from public,anon,authenticated;
revoke all on function public.finalize_wallet_withdrawal(uuid) from public,anon,authenticated;
revoke all on function public.credit_wallet_deposit(uuid,numeric,text,numeric,numeric,text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
revoke all on function public.post_creator_earning_atomic(uuid,numeric,text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.post_ad_revenue_atomic(uuid,numeric,date,date,bigint,bigint,numeric,text) from public,anon,authenticated;
revoke all on function public.issue_wallet_refund(uuid,uuid,numeric,text,text,text) from public,anon,authenticated;

grant execute on function public.add_to_wallet(uuid,numeric) to service_role;
grant execute on function public.reserve_wallet_funds(uuid,numeric,text) to service_role;
grant execute on function public.release_wallet_reservation(uuid,text) to service_role;
grant execute on function public.finalize_wallet_withdrawal(uuid) to service_role;
grant execute on function public.credit_wallet_deposit(uuid,numeric,text,numeric,numeric,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;
grant execute on function public.post_creator_earning_atomic(uuid,numeric,text,text,text,uuid,jsonb) to service_role;
grant execute on function public.post_ad_revenue_atomic(uuid,numeric,date,date,bigint,bigint,numeric,text) to service_role;
grant execute on function public.issue_wallet_refund(uuid,uuid,numeric,text,text,text) to service_role;

alter table public.audit_logs enable row level security;
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs for select to authenticated using (public.is_admin() or actor_user_id=auth.uid());

alter table public.platform_fee_settings enable row level security;
-- Fee configuration remains service-role/admin managed; no client write policy.
