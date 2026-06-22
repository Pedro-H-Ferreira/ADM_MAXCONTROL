create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to service_role;

create index if not exists app_suppliers_created_by_user_id_idx
  on public.app_suppliers (created_by_user_id);

create index if not exists app_suppliers_updated_by_user_id_idx
  on public.app_suppliers (updated_by_user_id);

create index if not exists app_supplier_audit_events_actor_user_id_idx
  on public.app_supplier_audit_events (actor_user_id);

create index if not exists app_user_profiles_approved_by_user_id_idx
  on public.app_user_profiles (approved_by_user_id);

create index if not exists app_user_profiles_home_branch_id_idx
  on public.app_user_profiles (home_branch_id);

create index if not exists fluig_job_events_agent_id_idx
  on public.fluig_job_events (agent_id);

create index if not exists fluig_jobs_branch_id_idx
  on public.fluig_jobs (branch_id);

create index if not exists fluig_requests_branch_id_idx
  on public.fluig_requests (branch_id);

drop policy if exists "no_direct_client_access_fluig_jobs" on public.fluig_jobs;
create policy "no_direct_client_access_fluig_jobs"
  on public.fluig_jobs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "no_direct_client_access_fluig_job_events" on public.fluig_job_events;
create policy "no_direct_client_access_fluig_job_events"
  on public.fluig_job_events
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "no_direct_client_access_fluig_user_agents" on public.fluig_user_agents;
create policy "no_direct_client_access_fluig_user_agents"
  on public.fluig_user_agents
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
