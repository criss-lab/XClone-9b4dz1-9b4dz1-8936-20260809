alter table public.federated_object_interactions drop constraint if exists federated_object_interactions_object_uri_fkey;
alter table public.federated_object_interactions drop constraint if exists federated_object_interactions_interaction_type_check;
alter table public.federated_object_interactions add constraint federated_object_interactions_interaction_type_check check (interaction_type = any (array['like','announce','repost','reply','quote','bookmark','view','not_interested']));
create index if not exists federated_interactions_activity_idx on public.federated_object_interactions(activity_uri) where activity_uri is not null;
notify pgrst,'reload schema';
