alter table public.federated_activities add column if not exists processing_state text not null default 'received';
alter table public.federated_activities add column if not exists next_processing_at timestamptz;
alter table public.federated_activities add column if not exists processed_at timestamptz;
alter table public.federated_activities add column if not exists dead_at timestamptz;
alter table public.federated_activities add column if not exists last_processing_error text;
alter table public.federated_activities add column if not exists processing_started_at timestamptz;
update public.federated_activities set processing_state=case when processed_at is not null then 'processed' when processing_error is not null then 'retry' else 'received' end where processing_state='received';
create index if not exists federated_activities_processing_queue_idx on public.federated_activities(processing_state,next_processing_at,received_at);
create index if not exists federated_activities_processing_lock_idx on public.federated_activities(processing_state,processing_started_at);
alter table public.federation_deliveries add column if not exists locked_at timestamptz;
create index if not exists federation_deliveries_lock_idx on public.federation_deliveries(status,locked_at);

alter table public.federated_actors add column if not exists last_key_verified_at timestamptz;
alter table public.federated_actors add column if not exists key_verification_error text;

create or replace function public.recover_stale_federation_delivery_locks(max_age interval default interval '10 minutes') returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  update federation_deliveries
  set status='retry', next_attempt_at=now(), locked_at=null, last_error=coalesce(last_error,'stale delivery lock recovered')
  where status='in_flight' and locked_at is not null and locked_at < now()-max_age;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.recover_stale_federation_processing(max_age interval default interval '15 minutes') returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  update federated_activities
  set processing_state='retry', next_processing_at=now(), processing_started_at=null, processing_error=coalesce(processing_error,'stale processing lock recovered'), last_processing_error=coalesce(last_processing_error,'stale processing lock recovered')
  where processing_state='processing' and processing_started_at is not null and processing_started_at < now()-max_age;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.recover_stale_federation_delivery_locks(interval) from public, anon, authenticated;
revoke execute on function public.recover_stale_federation_processing(interval) from public, anon, authenticated;
grant execute on function public.recover_stale_federation_delivery_locks(interval) to service_role;
grant execute on function public.recover_stale_federation_processing(interval) to service_role;
