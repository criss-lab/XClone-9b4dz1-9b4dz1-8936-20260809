begin;

create or replace function public.sync_post_media_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  urls jsonb := coalesce(new.media_urls, '[]'::jsonb);
  item jsonb;
  media_url text;
  media_id uuid;
  asset public.media_assets%rowtype;
  detected_type text;
  idx integer := 0;
begin
  if jsonb_typeof(urls) <> 'array' or jsonb_array_length(urls) = 0 then
    urls := '[]'::jsonb;
    if coalesce(new.video_url,'') <> '' then urls := jsonb_build_array(new.video_url);
    elsif coalesce(new.image_url,'') <> '' then urls := jsonb_build_array(new.image_url);
    end if;
  end if;

  delete from public.post_media where post_id = new.id;
  if jsonb_typeof(urls) <> 'array' then return new; end if;

  for item in select value from jsonb_array_elements(urls)
  loop
    media_url := trim(item #>> '{}');
    if media_url is null or media_url = '' or idx > 9 then continue; end if;
    media_id := null;
    begin
      if media_url ~ '/api/media/[0-9a-fA-F-]{36}$' then
        media_id := substring(media_url from '([0-9a-fA-F-]{36})$')::uuid;
      end if;
    exception when others then media_id := null;
    end;
    asset := null;
    if media_id is not null then select * into asset from public.media_assets where id = media_id limit 1; end if;

    detected_type := case
      when lower(coalesce(asset.media_type,'')) in ('image','video','audio','document','gif') then asset.media_type
      when coalesce(new.is_video,false) then 'video'
      when lower(media_url) ~ '\\.(mp4|webm|mov|m4v)(\\?|$)' then 'video'
      when lower(media_url) ~ '\\.(mp3|wav|m4a|ogg|aac)(\\?|$)' then 'audio'
      when lower(media_url) ~ '\\.(gif)(\\?|$)' then 'gif'
      else 'image'
    end;

    insert into public.post_media (post_id, owner_id, media_url, media_type, mime_type, byte_size, width, height, duration_ms, sort_order)
    values (new.id, new.author_id, media_url, detected_type, asset.mime_type, coalesce(asset.byte_size,0), asset.width, asset.height, asset.duration_ms, idx)
    on conflict (post_id, sort_order) do update set
      owner_id=excluded.owner_id, media_url=excluded.media_url, media_type=excluded.media_type,
      mime_type=excluded.mime_type, byte_size=excluded.byte_size, width=excluded.width,
      height=excluded.height, duration_ms=excluded.duration_ms;
    idx := idx + 1;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_sync_post_media_links on public.posts;
create trigger trg_sync_post_media_links
after insert or update of media_urls, image_url, video_url, is_video on public.posts
for each row execute function public.sync_post_media_links();
revoke all on function public.sync_post_media_links() from public;

create or replace function public.sync_post_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare tag_text text; hashtag_id uuid;
begin
  if tg_op = 'UPDATE' then delete from public.post_hashtags where post_id = new.id; end if;
  for tag_text in select distinct lower(m[1]) from regexp_matches(coalesce(new.content,''), '#([A-Za-z0-9_]{1,100})', 'g') as m limit 20 loop
    insert into public.hashtags(tag, post_count, last_used_at) values(tag_text,0,now())
      on conflict(tag) do update set last_used_at=now() returning id into hashtag_id;
    insert into public.post_hashtags(post_id, hashtag_id) values(new.id,hashtag_id) on conflict do nothing;
  end loop;
  update public.hashtags h set post_count=(select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id)
    where h.id in (select hashtag_id from public.post_hashtags where post_id=new.id);
  return new;
end;
$$;

drop trigger if exists trg_sync_post_hashtags on public.posts;
create trigger trg_sync_post_hashtags
after insert or update of content on public.posts
for each row execute function public.sync_post_hashtags();
revoke all on function public.sync_post_hashtags() from public;

notify pgrst, 'reload schema';
commit;
