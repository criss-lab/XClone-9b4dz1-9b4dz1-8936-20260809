revoke execute on function public.record_community_membership_payment(uuid,uuid,bigint,text,text,text) from public, anon, authenticated;
revoke execute on function public.record_audio_space_revenue(uuid,text,uuid,bigint,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.set_community_monetization(uuid,boolean,bigint,boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.set_community_monetization(uuid,boolean,bigint,boolean,boolean,boolean,boolean,boolean) to authenticated;
revoke execute on function public.set_audio_space_monetization(uuid,boolean,bigint,bigint,boolean,boolean,boolean) from public, anon;
grant execute on function public.set_audio_space_monetization(uuid,boolean,bigint,bigint,boolean,boolean,boolean) to authenticated;
