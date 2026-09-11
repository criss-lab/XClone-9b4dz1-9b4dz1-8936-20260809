create or replace function public.process_verification_request(p_request_id uuid,p_approve boolean,p_admin_notes text default null)
returns public.verification_requests
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := (select auth.uid()); v_row public.verification_requests; v_status text;
begin
  if v_admin is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.platform_admins a where a.user_id=v_admin) then raise exception 'Admin access required'; end if;
  v_status := case when p_approve then 'approved' else 'rejected' end;
  update public.verification_requests set status=v_status,admin_notes=coalesce(p_admin_notes,admin_notes),reviewed_at=now(),processed_at=now()
  where id=p_request_id and status='pending' returning * into v_row;
  if v_row.id is null then raise exception 'Verification request not found or already processed'; end if;
  if p_approve then
    update public.user_profiles set verified=true,verified_tier=v_row.tier,updated_at=now() where id=v_row.user_id;
    insert into public.notifications(user_id,type,from_user_id) values(v_row.user_id,'verified',v_admin);
  end if;
  return v_row;
end; $$;

revoke all on function public.process_verification_request(uuid,boolean,text) from public, anon;
grant execute on function public.process_verification_request(uuid,boolean,text) to authenticated;

drop policy if exists verification_documents_admin_read on storage.objects;
create policy verification_documents_admin_read on storage.objects
for select to authenticated
using (bucket_id='user-media' and (storage.foldername(name))[2]='verifications' and exists (select 1 from public.platform_admins a where a.user_id=(select auth.uid())));
