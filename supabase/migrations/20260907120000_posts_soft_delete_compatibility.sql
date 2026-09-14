begin;
alter table public.posts add column if not exists deleted_at timestamptz;
create index if not exists idx_posts_deleted_at on public.posts(deleted_at);
commit;
