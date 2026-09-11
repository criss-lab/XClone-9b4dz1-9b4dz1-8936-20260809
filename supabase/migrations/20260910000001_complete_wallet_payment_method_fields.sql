alter table public.wallets add column if not exists mpesa_phone text;

create or replace function public.update_wallet_payment_methods(
  p_mpesa_phone text default null,
  p_paypal_email text default null
) returns public.wallets
language plpgsql
security definer
set search_path=public
as $$
declare
  w public.wallets;
  v_email text;
  v_phone text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_email := nullif(lower(btrim(coalesce(p_paypal_email, ''))), '');
  v_phone := nullif(btrim(coalesce(p_mpesa_phone, '')), '');

  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$') then
    raise exception 'INVALID_PAYPAL_EMAIL';
  end if;

  update public.wallets
     set mpesa_phone = v_phone,
         paypal_email = v_email,
         updated_at = now()
   where user_id = auth.uid()
   returning * into w;

  if not found then
    insert into public.wallets(user_id, balance, currency, mpesa_phone, paypal_email)
    values(auth.uid(), 0, 'USD', v_phone, v_email)
    returning * into w;
  end if;

  return w;
end;
$$;

revoke all on function public.update_wallet_payment_methods(text,text) from public;
grant execute on function public.update_wallet_payment_methods(text,text) to authenticated;
