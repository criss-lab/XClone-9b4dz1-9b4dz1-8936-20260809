-- Security hardening: pin trigger-function search_path to prevent
-- session-controlled name resolution.
alter function public.federation_actor_workersdev_canonical()
  set search_path = '';
alter function public.federation_canonicalize_actor_url()
  set search_path = '';
