-- Small, atomic fixed-window rate limiter for security-sensitive Edge Functions.
create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer default 60
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_row public.rate_limit_buckets;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then raise exception 'Invalid rate-limit configuration'; end if;
  select * into v_row from public.rate_limit_buckets where bucket_key=p_bucket_key for update;
  if not found then
    insert into public.rate_limit_buckets(bucket_key,window_started_at,request_count)
    values(p_bucket_key,now(),1);
    return true;
  end if;
  if v_row.window_started_at + make_interval(secs=>p_window_seconds) <= now() then
    update public.rate_limit_buckets set window_started_at=now(),request_count=1,updated_at=now() where bucket_key=p_bucket_key;
    return true;
  end if;
  if v_row.request_count >= p_limit then return false; end if;
  update public.rate_limit_buckets set request_count=request_count+1,updated_at=now() where bucket_key=p_bucket_key;
  return true;
end;
$$;

revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;

alter table public.rate_limit_buckets enable row level security;
