create or replace function public.sync_federation_object_projection() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb := coalesce(new.object,'{}'::jsonb); actor_uri text := coalesce(new.actor_url, case when jsonb_typeof(o->'attributedTo')='string' then o->>'attributedTo' else o->'attributedTo'->>'id' end); begin
  insert into public.federated_objects(uri,object_type,actor_uri,url,content,summary,published_at,updated_at,sensitive,in_reply_to_uri,quote_uri,attachments,tags,raw_object)
  values(new.object_url,coalesce(new.object_type,o->>'type','Object'),actor_uri,coalesce(o->>'url',new.object_url),coalesce(o->>'content',o->>'name'),o->>'summary',case when o->>'published' is not null then (o->>'published')::timestamptz else new.published_at end,case when o->>'updated' is not null then (o->>'updated')::timestamptz else new.updated_at end,coalesce((o->>'sensitive')::boolean,false),o->>'inReplyTo',coalesce(o->>'quoteUrl',o->>'quoteUri',o->>'_misskey_quote'),coalesce(o->'attachment','[]'::jsonb),coalesce(o->'tag','[]'::jsonb),o)
  on conflict(uri) do update set object_type=excluded.object_type,actor_uri=excluded.actor_uri,url=excluded.url,content=excluded.content,summary=excluded.summary,published_at=excluded.published_at,updated_at=excluded.updated_at,sensitive=excluded.sensitive,in_reply_to_uri=excluded.in_reply_to_uri,quote_uri=excluded.quote_uri,attachments=excluded.attachments,tags=excluded.tags,raw_object=excluded.raw_object;
  return new;
end; $$;
drop trigger if exists federation_objects_canonical_projection on public.federation_objects;
create trigger federation_objects_canonical_projection after insert or update on public.federation_objects for each row execute function public.sync_federation_object_projection();
notify pgrst,'reload schema';
