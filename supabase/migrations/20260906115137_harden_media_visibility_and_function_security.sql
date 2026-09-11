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

create or replace function public.get_stream_chat_analytics(p_stream_id uuid)
returns table(message_count bigint, unique_users bigint, first_message_at timestamptz, last_message_at timestamptz)
language sql
set search_path = public
as $$
  select count(*)::bigint,
         count(distinct user_id)::bigint,
         min(created_at),
         max(created_at)
  from public.stream_chat
  where stream_id = p_stream_id
    and message not like '[REACT:%]';
$$;

revoke execute on function public.bump_post_repost_count() from authenticated;
revoke execute on function public.bump_post_repost_count() from anon;

create index if not exists post_media_media_url_idx on public.post_media (media_url);
create index if not exists posts_id_deleted_at_idx on public.posts (id, deleted_at);;
