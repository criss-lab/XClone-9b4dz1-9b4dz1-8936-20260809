-- Separate transport delivery state from remote acceptance state.
-- state remains the remote relationship lifecycle; delivery_state describes
-- whether the Follow/Undo request reached the remote inbox.
alter table public.federated_follow_relationships
  add column if not exists delivery_state text not null default 'not_sent'
    check (delivery_state in ('not_sent', 'delivered', 'failed'));

alter table public.federated_follow_relationships
  add column if not exists delivery_attempts integer not null default 0;

alter table public.federated_follow_relationships
  add column if not exists last_delivery_at timestamptz;

create index if not exists federated_follow_relationships_delivery_idx
  on public.federated_follow_relationships(local_user_id, delivery_state, updated_at desc);
