begin;

-- Post creation compatibility repair.
-- The web composer writes canonical fields (content, media_urls, image_url,
-- video_url) while older post constraints/readers still depend on body,
-- media_url, media_type, and media_count. Keep those representations aligned.
alter table if exists public.posts
  add column if not exists media_count integer not null default 0;

update public.posts
set media_count = case
  when jsonb_typeof(media_urls) = 'array' and jsonb_array_length(media_urls) > 0
    then jsonb_array_length(media_urls)
  when video_url is not null or image_url is not null or media_url is not null
    then 1
  else 0
end;

create or replace function public.sync_post_media_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.media_urls is not null
     and jsonb_typeof(new.media_urls) = 'array'
     and jsonb_array_length(new.media_urls) > 0 then
    new.media_count := jsonb_array_length(new.media_urls);
  elsif new.video_url is not null
     or new.image_url is not null
     or new.media_url is not null then
    new.media_count := 1;
  else
    new.media_count := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_post_media_count on public.posts;
create trigger trg_sync_post_media_count
before insert or update of media_urls, media_url, image_url, video_url
on public.posts
for each row execute function public.sync_post_media_count();
revoke all on function public.sync_post_media_count() from public;

create or replace function public.sync_post_legacy_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.body, '') = '' and new.content is not null then
    new.body := new.content;
  end if;

  if new.media_url is null then
    if new.video_url is not null then
      new.media_url := new.video_url;
      new.media_type := 'video';
    elsif new.image_url is not null then
      new.media_url := new.image_url;
      new.media_type := 'image';
    elsif new.media_urls is not null
      and jsonb_typeof(new.media_urls) = 'array'
      and jsonb_array_length(new.media_urls) > 0 then
      new.media_url := new.media_urls ->> 0;
      new.media_type := 'image';
    end if;
  elsif new.media_type is null then
    if new.video_url is not null then
      new.media_type := 'video';
    else
      new.media_type := 'image';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_post_legacy_columns on public.posts;
create trigger trg_sync_post_legacy_columns
before insert or update on public.posts
for each row execute function public.sync_post_legacy_columns();
revoke all on function public.sync_post_legacy_columns() from public;

notify pgrst, 'reload schema';
commit;
