begin;

-- Surgical repair: PL/pgSQL previously had a variable named hashtag_id while
-- the final subquery also selected the post_hashtags.hashtag_id column.
-- PostgreSQL therefore raised: column reference "hashtag_id" is ambiguous.
create or replace function public.sync_post_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tag_text text;
  v_hashtag_id uuid;
begin
  if tg_op = 'UPDATE' then
    delete from public.post_hashtags where post_id = new.id;
  end if;

  for tag_text in
    select distinct lower(m[1])
    from regexp_matches(coalesce(new.content,''), '#([A-Za-z0-9_]{1,100})', 'g') as m
    limit 20
  loop
    insert into public.hashtags(tag, post_count, last_used_at)
      values (tag_text, 0, now())
      on conflict (tag) do update set last_used_at = now()
      returning id into v_hashtag_id;

    insert into public.post_hashtags(post_id, hashtag_id)
      values (new.id, v_hashtag_id)
      on conflict do nothing;
  end loop;

  update public.hashtags h
  set post_count = (
    select count(*)
    from public.post_hashtags ph
    where ph.hashtag_id = h.id
  )
  where h.id in (
    select ph.hashtag_id
    from public.post_hashtags ph
    where ph.post_id = new.id
  )
  or (
    tg_op = 'UPDATE'
    and h.id in (
      select ph.hashtag_id
      from public.post_hashtags ph
      where ph.post_id = old.id
    )
  );

  return new;
end;
$$;

revoke all on function public.sync_post_hashtags() from public;
notify pgrst, 'reload schema';

commit;
