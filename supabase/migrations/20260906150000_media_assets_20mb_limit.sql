-- Testagram media contract: metadata lives in Postgres; binary media lives in Cloudflare R2.
-- Keep this invariant in the database so every write path enforces the same 20 MiB ceiling.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.media_assets'::regclass
      and conname = 'media_assets_byte_size_max_20mb'
  ) then
    alter table public.media_assets
      add constraint media_assets_byte_size_max_20mb
      check (byte_size > 0 and byte_size <= 20971520);
  end if;
end
$$;

comment on table public.media_assets is
  'Testagram media metadata. Binary objects are stored in Cloudflare R2; byte_size is capped at 20 MiB.';
comment on column public.media_assets.storage_key is
  'Cloudflare R2 object key for the binary media.';
comment on column public.media_assets.media_url is
  'Testagram API media URL; binary content is served by the Cloudflare Worker from R2.';
