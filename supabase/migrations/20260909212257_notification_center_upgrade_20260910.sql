create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  notif_type text not null, in_app boolean not null default true, push boolean not null default false, email boolean not null default false,
  sound_enabled boolean not null default true, vibration_enabled boolean not null default true,
  digest_frequency text not null default 'instant' check (digest_frequency in ('instant','hourly','daily','weekly','off')),
  quiet_hours_start time, quiet_hours_end time, timezone text not null default 'UTC', muted_until timestamptz,
  updated_at timestamptz not null default now(), unique(user_id, notif_type)
);
alter table public.notification_preferences enable row level security;
drop policy if exists notification_preferences_select_own on public.notification_preferences;
drop policy if exists notification_preferences_insert_own on public.notification_preferences;
drop policy if exists notification_preferences_update_own on public.notification_preferences;
drop policy if exists notification_preferences_delete_own on public.notification_preferences;
create policy notification_preferences_select_own on public.notification_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy notification_preferences_insert_own on public.notification_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy notification_preferences_update_own on public.notification_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notification_preferences_delete_own on public.notification_preferences for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.notifications add column if not exists priority text not null default 'normal' check (priority in ('low','normal','high','urgent'));
alter table public.notifications add column if not exists category text not null default 'social';
alter table public.notifications add column if not exists group_key text;
alter table public.notifications add column if not exists action_url text;
alter table public.notifications add column if not exists expires_at timestamptz;
alter table public.notifications add column if not exists archived_at timestamptz;
alter table public.notifications add column if not exists dedupe_key text;
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);
create index if not exists notifications_recipient_unread_idx on public.notifications(recipient_id, read_at, created_at desc) where read_at is null;
create index if not exists notifications_recipient_category_idx on public.notifications(recipient_id, category, created_at desc);
create unique index if not exists notifications_dedupe_key_uidx on public.notifications(dedupe_key) where dedupe_key is not null;

create or replace function public.mark_notifications_read(p_notification_ids uuid[] default null) returns integer language plpgsql security invoker set search_path=public as $$ declare v_count integer; begin update public.notifications set read_at=coalesce(read_at,now()) where recipient_id=(select auth.uid()) and read_at is null and (p_notification_ids is null or id=any(p_notification_ids)); get diagnostics v_count=row_count; return v_count; end; $$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon; grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
create or replace function public.archive_notifications(p_notification_ids uuid[]) returns integer language plpgsql security invoker set search_path=public as $$ declare v_count integer; begin update public.notifications set archived_at=coalesce(archived_at,now()) where recipient_id=(select auth.uid()) and id=any(p_notification_ids); get diagnostics v_count=row_count; return v_count; end; $$;
revoke all on function public.archive_notifications(uuid[]) from public, anon; grant execute on function public.archive_notifications(uuid[]) to authenticated;
create or replace function public.restore_notifications(p_notification_ids uuid[]) returns integer language plpgsql security invoker set search_path=public as $$ declare v_count integer; begin update public.notifications set archived_at=null where recipient_id=(select auth.uid()) and id=any(p_notification_ids); get diagnostics v_count=row_count; return v_count; end; $$;
revoke all on function public.restore_notifications(uuid[]) from public, anon; grant execute on function public.restore_notifications(uuid[]) to authenticated;
create or replace function public.upsert_notification_preference(p_notif_type text,p_in_app boolean,p_push boolean,p_email boolean,p_sound_enabled boolean default true,p_vibration_enabled boolean default true,p_digest_frequency text default 'instant',p_quiet_hours_start time default null,p_quiet_hours_end time default null,p_timezone text default 'UTC',p_muted_until timestamptz default null) returns public.notification_preferences language plpgsql security invoker set search_path=public as $$ declare v_row public.notification_preferences; begin if p_notif_type is null or length(trim(p_notif_type))=0 then raise exception 'NOTIFICATION_TYPE_REQUIRED'; end if; insert into public.notification_preferences(user_id,notif_type,in_app,push,email,sound_enabled,vibration_enabled,digest_frequency,quiet_hours_start,quiet_hours_end,timezone,muted_until,updated_at) values((select auth.uid()),trim(p_notif_type),p_in_app,p_push,p_email,p_sound_enabled,p_vibration_enabled,p_digest_frequency,p_quiet_hours_start,p_quiet_hours_end,coalesce(nullif(trim(p_timezone),''),'UTC'),p_muted_until,now()) on conflict(user_id,notif_type) do update set in_app=excluded.in_app,push=excluded.push,email=excluded.email,sound_enabled=excluded.sound_enabled,vibration_enabled=excluded.vibration_enabled,digest_frequency=excluded.digest_frequency,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,timezone=excluded.timezone,muted_until=excluded.muted_until,updated_at=now() returning * into v_row; return v_row; end; $$;
revoke all on function public.upsert_notification_preference(text,boolean,boolean,boolean,boolean,boolean,text,time,time,text,timestamptz) from public, anon; grant execute on function public.upsert_notification_preference(text,boolean,boolean,boolean,boolean,boolean,text,time,time,text,timestamptz) to authenticated;
