-- Federated posting metadata. Keeps remote identity separate from local profiles.
create table if not exists public.federation_post_tags (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  object_url text,
  tag_type text not null check (tag_type in ('Mention','Hashtag')),
  name text not null,
  href text,
  acct text,
  created_at timestamptz not null default now()
);

create index if not exists federation_post_tags_post_idx on public.federation_post_tags(post_id);
create index if not exists federation_post_tags_name_idx on public.federation_post_tags(tag_type, lower(name));
create index if not exists federation_post_tags_acct_idx on public.federation_post_tags(lower(acct));
create unique index if not exists federation_post_tags_identity_idx
  on public.federation_post_tags(post_id, tag_type, name, coalesce(href, ''));

alter table public.federation_post_tags enable row level security;

drop policy if exists "federation post tags readable" on public.federation_post_tags;
create policy "federation post tags readable" on public.federation_post_tags
for select to authenticated using (true);

drop policy if exists "federation post tags own insert" on public.federation_post_tags;
create policy "federation post tags own insert" on public.federation_post_tags
for insert to authenticated with check (
  exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
);

-- Remote identities used by autocomplete can be refreshed independently of posts.
create index if not exists federation_remote_actors_username_idx on public.federation_remote_actors(lower(username));
create index if not exists federation_remote_actors_acct_idx on public.federation_remote_actors(lower(acct));
