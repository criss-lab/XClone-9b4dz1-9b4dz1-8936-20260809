create or replace function public.record_community_membership_payment(
  p_community_id uuid, p_buyer_id uuid, p_gross_cents bigint, p_idempotency_key text,
  p_provider text default null, p_provider_reference text default null
) returns public.monetization_ledger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_cfg public.community_monetization; v_event public.monetization_ledger;
begin
  if (select current_user) <> 'service_role' then raise exception 'server_only'; end if;
  select owner_id into v_owner from public.communities where id=p_community_id;
  if v_owner is null then raise exception 'COMMUNITY_NOT_FOUND'; end if;
  select * into v_cfg from public.community_monetization where community_id=p_community_id;
  if not found or not v_cfg.enabled then raise exception 'COMMUNITY_MONETIZATION_DISABLED'; end if;
  if p_gross_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_event := public.record_creator_earning(v_owner,'community',p_gross_cents,p_idempotency_key,p_provider,null,'community_membership',p_community_id::text,'Community membership payment',jsonb_build_object('buyer_id',p_buyer_id,'community_id',p_community_id),v_cfg.creator_share_bps);
  return v_event;
end; $$;

create or replace function public.record_audio_space_revenue(
  p_space_id uuid, p_event_type text, p_buyer_id uuid, p_gross_cents bigint, p_idempotency_key text,
  p_provider text default null, p_provider_event_id text default null, p_source_type text default 'audio_space'
) returns public.monetization_ledger
language plpgsql security definer set search_path = '' as $$
declare v_host uuid; v_cfg public.audio_space_monetization; v_event public.monetization_ledger;
begin
  if (select current_user) <> 'service_role' then raise exception 'server_only'; end if;
  if p_event_type not in ('live_event','live_gift','ad_revenue','sponsorship') then raise exception 'INVALID_AUDIO_SPACE_REVENUE_TYPE'; end if;
  select host_id into v_host from public.audio_spaces where id=p_space_id;
  if v_host is null then raise exception 'SPACE_NOT_FOUND'; end if;
  select * into v_cfg from public.audio_space_monetization where space_id=p_space_id;
  if not found or not v_cfg.enabled then raise exception 'AUDIO_SPACE_MONETIZATION_DISABLED'; end if;
  if p_gross_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_event := public.record_creator_earning(v_host,p_event_type,p_gross_cents,p_idempotency_key,p_provider,p_provider_event_id,p_source_type,p_space_id::text,'Audio Space monetization',jsonb_build_object('buyer_id',p_buyer_id,'space_id',p_space_id),v_cfg.creator_share_bps);
  return v_event;
end; $$;

revoke all on function public.record_community_membership_payment(uuid,uuid,bigint,text,text,text) from public;
revoke all on function public.record_audio_space_revenue(uuid,text,uuid,bigint,text,text,text,text) from public;
