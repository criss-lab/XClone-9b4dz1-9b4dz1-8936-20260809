alter table public.verification_requests
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_amount numeric(12,2) not null default 0,
  add column if not exists admin_notes text,
  add column if not exists processed_at timestamptz;

create or replace function public.submit_verification_request(p_tier text, p_admin_notes text default null)
returns public.verification_requests
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_price numeric(12,2); v_row public.verification_requests;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_tier not in ('blue','gold','business') then raise exception 'Invalid verification tier'; end if;
  v_price := case p_tier when 'blue' then 5 when 'gold' then 15 when 'business' then 25 end;
  if exists (select 1 from public.verification_requests r where r.user_id=v_user and r.status='pending') then raise exception 'A verification request is already under review'; end if;
  insert into public.verification_requests(user_id,tier,status,payment_status,payment_amount,admin_notes)
  values(v_user,p_tier,'pending','pending',v_price,p_admin_notes) returning * into v_row;
  return v_row;
end; $$;

revoke all on function public.submit_verification_request(text,text) from public, anon;
grant execute on function public.submit_verification_request(text,text) to authenticated;
