alter table public.app_user_profiles
  drop constraint if exists app_user_profiles_role_check;

alter table public.app_user_profiles
  add constraint app_user_profiles_role_check
  check (
    role in (
      'ADMIN_MASTER',
      'ADMIN',
      'ADMINISTRATIVO',
      'GERENTE_CD',
      'FINANCEIRO',
      'COMPRAS',
      'MANUTENCAO',
      'LEITURA'
    )
  );

revoke all privileges on table
  public.fluig_requests,
  public.fluig_request_events,
  public.fluig_operation_runs,
  public.fluig_supplier_candidates,
  public.fluig_supplier_links,
  public.fluig_user_sync_state,
  public.fluig_jobs,
  public.fluig_job_events,
  public.fluig_user_agents
from anon;

revoke all privileges on table
  public.fluig_requests,
  public.fluig_request_events,
  public.fluig_operation_runs,
  public.fluig_supplier_candidates,
  public.fluig_supplier_links,
  public.fluig_user_sync_state
from authenticated;

grant select on table
  public.fluig_requests,
  public.fluig_request_events,
  public.fluig_operation_runs,
  public.fluig_supplier_candidates,
  public.fluig_supplier_links,
  public.fluig_user_sync_state
to authenticated;

revoke all privileges on table
  public.fluig_jobs,
  public.fluig_job_events,
  public.fluig_user_agents
from authenticated;

drop policy if exists "authenticated_read_fluig_requests" on public.fluig_requests;
create policy "authenticated_read_fluig_requests"
  on public.fluig_requests for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and (
          profile.role in ('ADMIN_MASTER', 'ADMIN')
          or fluig_requests.sync_owner_user_id = profile.id
          or fluig_requests.created_by_user_id = profile.id
          or (
            profile.fluig_username is not null
            and lower(profile.fluig_username) in (
              lower(coalesce(fluig_requests.fluig_requester_login, '')),
              lower(coalesce(fluig_requests.fluig_requester_code, '')),
              lower(coalesce(fluig_requests.requester, ''))
            )
          )
          or (
            profile.fluig_user_id is not null
            and lower(profile.fluig_user_id) in (
              lower(coalesce(fluig_requests.fluig_requester_login, '')),
              lower(coalesce(fluig_requests.fluig_requester_code, '')),
              lower(coalesce(fluig_requests.requester, ''))
            )
          )
          or exists (
            select 1
            from public.app_user_branch_access access
            join public.app_branches branch on branch.id = access.branch_id
            where access.user_id = profile.id
              and access.can_view = true
              and (
                access.branch_id = fluig_requests.branch_id
                or branch.code = fluig_requests.branch_code
              )
          )
        )
    )
  );

drop policy if exists "authenticated_read_fluig_request_events" on public.fluig_request_events;
create policy "authenticated_read_fluig_request_events"
  on public.fluig_request_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.fluig_requests request
      where request.id = fluig_request_events.fluig_request_id
    )
  );

drop policy if exists "authenticated_read_fluig_operation_runs" on public.fluig_operation_runs;
drop policy if exists "admin_read_fluig_operation_runs" on public.fluig_operation_runs;
create policy "admin_read_fluig_operation_runs"
  on public.fluig_operation_runs for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and profile.role in ('ADMIN_MASTER', 'ADMIN')
    )
  );

drop policy if exists "authenticated_read_fluig_supplier_candidates" on public.fluig_supplier_candidates;
drop policy if exists "admin_read_fluig_supplier_candidates" on public.fluig_supplier_candidates;
create policy "admin_read_fluig_supplier_candidates"
  on public.fluig_supplier_candidates for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and profile.role in ('ADMIN_MASTER', 'ADMIN')
    )
  );

drop policy if exists "authenticated_read_fluig_supplier_links" on public.fluig_supplier_links;
create policy "authenticated_read_fluig_supplier_links"
  on public.fluig_supplier_links for select
  to authenticated
  using (
    active = true
    and (
      exists (
        select 1
        from public.app_user_profiles profile
        where profile.auth_user_id = (select auth.uid())
          and profile.active = true
          and profile.approval_status = 'APPROVED'
          and profile.role in ('ADMIN_MASTER', 'ADMIN')
      )
      or exists (
        select 1
        from public.app_suppliers supplier
        where supplier.id = fluig_supplier_links.app_supplier_id
          and supplier.deleted_at is null
      )
    )
  );

drop policy if exists "authenticated_read_fluig_user_sync_state" on public.fluig_user_sync_state;
create policy "authenticated_read_fluig_user_sync_state"
  on public.fluig_user_sync_state for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and (
          profile.role in ('ADMIN_MASTER', 'ADMIN')
          or profile.id = fluig_user_sync_state.user_id
        )
    )
  );
