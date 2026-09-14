-- Production hardening: SECURITY DEFINER functions in the exposed public schema
-- must not be callable by unauthenticated clients. Keep server-side/service_role
-- execution intact; authenticated access is preserved for existing app RPCs.
do $$
declare
  r record;
begin
  for r in
    select p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
  loop
    execute format('revoke execute on function %I.%I(%s) from anon', r.nspname, r.proname, r.args);
  end loop;
end $$;
