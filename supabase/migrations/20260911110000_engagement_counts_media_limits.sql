-- X-style engagement hardening: counters are derived from relational rows, not client guesses.

alter table if exists public.replies
  add column if not exists media_urls text[] default '{}'::text[],
  add column if not exists media_count integer generated always as (coalesce(array_length(media_urls, 1), 0)) stored,
  add column if not exists media_bytes bigint default 0;

create or replace function public.enforce_reply_media_limit()
returns trigger language plpgsql as $$
begin
  if coalesce(new.media_bytes, 0) > 20971520 then
    raise exception 'Reply media must be smaller than 20 MB';
  end if;
  return new;
end;
$$;

DO $$
BEGIN
  IF to_regclass('public.replies') IS NOT NULL THEN
    execute 'drop trigger if exists replies_media_limit on public.replies';
    execute 'create trigger replies_media_limit before insert or update on public.replies for each row execute function public.enforce_reply_media_limit()';
  END IF;
END $$;

create or replace function public.refresh_post_engagement_counts(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_likes bigint := 0; v_replies bigint := 0; v_reposts bigint := 0;
begin
  if to_regclass('public.likes') is not null then execute 'select count(*) from public.likes where post_id = $1' into v_likes using p_post_id; end if;
  if to_regclass('public.replies') is not null then execute 'select count(*) from public.replies where post_id = $1' into v_replies using p_post_id; end if;
  if to_regclass('public.reposts') is not null then execute 'select count(*) from public.reposts where post_id = $1' into v_reposts using p_post_id;
  elsif to_regclass('public.post_reposts') is not null then execute 'select count(*) from public.post_reposts where post_id = $1' into v_reposts using p_post_id; end if;
  update public.posts set likes_count = v_likes, reposts_count = v_reposts, replies_count = v_replies where id = p_post_id;
end;
$$;

create or replace function public.refresh_post_counts_from_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_post_engagement_counts(coalesce(new.post_id, old.post_id)); return coalesce(new, old);
end;
$$;

DO $$
BEGIN
  IF to_regclass('public.likes') IS NOT NULL THEN execute 'drop trigger if exists likes_refresh_post_counts on public.likes'; execute 'create trigger likes_refresh_post_counts after insert or delete on public.likes for each row execute function public.refresh_post_counts_from_row()'; END IF;
  IF to_regclass('public.replies') IS NOT NULL THEN execute 'drop trigger if exists replies_refresh_post_counts on public.replies'; execute 'create trigger replies_refresh_post_counts after insert or delete on public.replies for each row execute function public.refresh_post_counts_from_row()'; END IF;
  IF to_regclass('public.reposts') IS NOT NULL THEN execute 'drop trigger if exists reposts_refresh_post_counts on public.reposts'; execute 'create trigger reposts_refresh_post_counts after insert or delete on public.reposts for each row execute function public.refresh_post_counts_from_row()';
  ELSIF to_regclass('public.post_reposts') IS NOT NULL THEN execute 'drop trigger if exists post_reposts_refresh_post_counts on public.post_reposts'; execute 'create trigger post_reposts_refresh_post_counts after insert or delete on public.post_reposts for each row execute function public.refresh_post_counts_from_row()'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.replies') IS NOT NULL THEN execute 'create index if not exists replies_post_created_at_idx on public.replies(post_id, created_at)'; END IF;
  IF to_regclass('public.likes') IS NOT NULL THEN execute 'create index if not exists likes_post_created_at_idx on public.likes(post_id, created_at)'; END IF;
END $$;
