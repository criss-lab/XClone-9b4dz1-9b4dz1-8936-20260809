begin;

-- Persist verified inbound ActivityPub Create/Update activities as canonical
-- federated_objects so the shared hashtag/search layer sees real federation ingress.
create or replace function public.ingest_federation_inbox_object()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  activity jsonb;
  object jsonb;
  object_id text;
  object_type text;
  actor_uri text;
  instance_domain text;
  instance_id uuid;
  published timestamptz;
  updated timestamptz;
  object_url text;
  content text;
  summary text;
  sensitive boolean;
  tags jsonb;
begin
  activity := coalesce(new.payload,'{}'::jsonb);
  if coalesce(new.activity_type,'') not in ('Create','Update') then return new; end if;
  object := case when jsonb_typeof(activity->'object')='object' then activity->'object' else null end;
  if object is null then return new; end if;
  object_id := nullif(coalesce(object->>'id',activity->>'object'),'');
  if object_id is null then return new; end if;
  object_type := coalesce(nullif(object->>'type',''),'Note');
  actor_uri := nullif(coalesce(object->>'attributedTo',activity->>'actor',new.actor_url),'');
  instance_domain := nullif(lower(split_part(regexp_replace(coalesce(actor_uri,''),'^https?://',''), '/', 1)), '');
  if instance_domain is not null then
    insert into public.federated_instances(domain,software_name,protocol,status,last_seen_at)
    values(instance_domain,'ActivityPub','activitypub','active',now())
    on conflict(domain) do update set last_seen_at=now(),updated_at=now()
    returning id into instance_id;
  end if;
  published := nullif(coalesce(object->>'published',activity->>'published'),'')::timestamptz;
  updated := nullif(coalesce(object->>'updated',object->>'published',activity->>'updated',activity->>'published'),'')::timestamptz;
  object_url := nullif(coalesce(object->>'url',object->>'id'),'');
  content := nullif(coalesce(object->>'content',object->>'name',''),'');
  summary := nullif(coalesce(object->>'summary',''),'');
  sensitive := coalesce((object->>'sensitive')::boolean,false);
  tags := case when jsonb_typeof(object->'tag')='array' then object->'tag' else '[]'::jsonb end;
  insert into public.federated_objects(uri,object_type,actor_uri,instance_id,url,content,summary,published_at,updated_at,sensitive,tags,raw_object)
  values(object_id,object_type,actor_uri,instance_id,object_url,content,summary,published,updated,sensitive,tags,object)
  on conflict(uri) do update set
    object_type=excluded.object_type,
    actor_uri=coalesce(excluded.actor_uri,public.federated_objects.actor_uri),
    instance_id=coalesce(excluded.instance_id,public.federated_objects.instance_id),
    url=coalesce(excluded.url,public.federated_objects.url),
    content=excluded.content,
    summary=excluded.summary,
    published_at=coalesce(excluded.published_at,public.federated_objects.published_at),
    updated_at=coalesce(excluded.updated_at,public.federated_objects.updated_at),
    sensitive=excluded.sensitive,
    tags=excluded.tags,
    raw_object=excluded.raw_object,
    deleted_at=null;
  return new;
exception when others then
  raise warning 'federation object ingest failed for activity %: %',new.activity_id,sqlerrm;
  return new;
end;
$$;

revoke all on function public.ingest_federation_inbox_object() from public;
drop trigger if exists federation_inbox_ingest_object on public.federation_inbox;
create trigger federation_inbox_ingest_object
after insert or update of payload on public.federation_inbox
for each row execute function public.ingest_federation_inbox_object();

-- Replay previously received Create/Update activities through the new trigger.
do $$
declare r record;
begin
  for r in select id from public.federation_inbox where activity_type in ('Create','Update') and payload is not null loop
    update public.federation_inbox set payload=payload where id=r.id;
  end loop;
end;
$$;

commit;
