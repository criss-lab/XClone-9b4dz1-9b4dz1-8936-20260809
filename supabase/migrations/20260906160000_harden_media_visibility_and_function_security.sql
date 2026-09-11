-- Production security hardening for media access and exposed functions.

create or replace function public.validate_profile_avatar_url()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.avatar_url is not null and new.avatar_url <> '' and position('/storage/v1/object/public/tv49-profile-media/avatars/' in new.avatar_url) = 0 then
    raise exception 'avatar_url must point to the TV 49 profile media bucket';
  end if;
  return new;
end;
$$;
-- stream_chat is optional in a fresh deployment. Only install its analytics
-- function when the underlying table exists.
do $$
begin
  if to_regclass('public.stream_chat') is not null then
    execute $fn$
      create or replace function public.get_stream_chat_analytics(p_stream_id uuid)
      returns table(message_count bigint, unique_users bigint, first_message_at timestamptz, last_message_at timestamptz)
      language sql
      set search_path = public
      as $body$
        select count(*)::bigint,
               count(distinct user_id)::bigint,
               min(created_at),
               max(created_at)
        from public.stream_chat
        where stream_id = p_stream_id
          and message not like '[REACT:%]';
      $body$
    $fn$;
  end if;
end
$$;
-- Trigger helper may not exist in a fresh schema; revoke it only when present.
do $$
begin
  if to_regprocedure('public.bump_post_repost_count()') is not null then
    revoke execute on function public.bump_post_repost_count() from authenticated;
    revoke execute on function public.bump_post_repost_count() from anon;
  end if;
end
$$;
-- Optional media tables/columns are hardened when present.
do $$
begin
  if to_regclass('public.post_media') is not null then
    execute 'create index if not exists post_media_media_url_idx on public.post_media (media_url)';
  end if;
  if to_regclass('public.posts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'deleted_at') then
    execute 'create index if not exists posts_id_deleted_at_idx on public.posts (id, deleted_at)';
  end if;
end
$$;
