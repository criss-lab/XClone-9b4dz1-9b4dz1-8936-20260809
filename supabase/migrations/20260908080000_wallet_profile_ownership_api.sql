begin;

create unique index if not exists wallets_user_id_unique on public.wallets(user_id);

create or replace function public.ensure_user_wallet(p_user_id uuid, p_currency text default 'USD')
returns public.wallets
language plpgsql security definer set search_path = public
as $$
declare w public.wallets;
begin
  if p_user_id is null then raise exception 'USER_ID_REQUIRED'; end if;
  if auth.role() = 'authenticated' and auth.uid() <> p_user_id then raise exception 'FORBIDDEN'; end if;
  insert into public.wallets(user_id,balance,currency)
  values(p_user_id,0,coalesce(nullif(trim(p_currency),''),'USD'))
  on conflict(user_id) do nothing;
  select * into w from public.wallets where user_id=p_user_id for update;
  return w;
end; $$;
revoke all on function public.ensure_user_wallet(uuid,text) from public, anon;
grant execute on function public.ensure_user_wallet(uuid,text) to authenticated, service_role;

create or replace function public.provision_profile_wallet()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.wallets(user_id,balance,currency)
  values(new.id,0,'USD')
  on conflict(user_id) do nothing;
  return new;
end; $$;

drop trigger if exists profiles_provision_wallet on public.profiles;
create trigger profiles_provision_wallet
after insert on public.profiles
for each row execute function public.provision_profile_wallet();

insert into public.wallets(user_id,balance,currency)
select p.id,0,'USD' from public.profiles p
left join public.wallets w on w.user_id=p.id
where w.id is null;

create or replace function public.get_my_wallet()
returns public.wallets
language plpgsql security definer set search_path = public
as $$
declare w public.wallets;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into w from public.wallets where user_id=auth.uid() for update;
  if not found then select * into w from public.ensure_user_wallet(auth.uid(),'USD'); end if;
  return w;
end; $$;
revoke all on function public.get_my_wallet() from public, anon;
grant execute on function public.get_my_wallet() to authenticated;

create or replace function public.get_my_wallet_transactions(p_limit integer default 100, p_offset integer default 0)
returns setof public.wallet_transactions
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return query
    select t.* from public.wallet_transactions t
    join public.wallets w on w.id=t.wallet_id
    where w.user_id=auth.uid()
    order by t.created_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
    offset greatest(0,coalesce(p_offset,0));
end; $$;
revoke all on function public.get_my_wallet_transactions(integer,integer) from public, anon;
grant execute on function public.get_my_wallet_transactions(integer,integer) to authenticated;

commit;
