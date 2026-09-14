begin;
revoke execute on function public.send_creator_tip(uuid,bigint,text,text) from public;
revoke execute on function public.send_creator_tip(uuid,bigint,text,text) from anon;
revoke execute on function public.send_creator_tip(uuid,bigint,text,text) from service_role;
grant execute on function public.send_creator_tip(uuid,bigint,text,text) to authenticated;
commit;
