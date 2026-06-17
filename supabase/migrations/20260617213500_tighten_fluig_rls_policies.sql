drop policy if exists "authenticated_write_fluig_process_mappings" on public.fluig_process_mappings;
drop policy if exists "authenticated_all_fluig_requests" on public.fluig_requests;
drop policy if exists "authenticated_all_fluig_request_events" on public.fluig_request_events;
drop policy if exists "authenticated_all_fluig_operation_runs" on public.fluig_operation_runs;
drop policy if exists "authenticated_all_fluig_supplier_candidates" on public.fluig_supplier_candidates;
drop policy if exists "authenticated_all_fluig_supplier_links" on public.fluig_supplier_links;

drop policy if exists "authenticated_read_fluig_requests" on public.fluig_requests;
create policy "authenticated_read_fluig_requests"
  on public.fluig_requests for select
  to authenticated
  using (true);

drop policy if exists "authenticated_read_fluig_request_events" on public.fluig_request_events;
create policy "authenticated_read_fluig_request_events"
  on public.fluig_request_events for select
  to authenticated
  using (true);

drop policy if exists "authenticated_read_fluig_operation_runs" on public.fluig_operation_runs;
create policy "authenticated_read_fluig_operation_runs"
  on public.fluig_operation_runs for select
  to authenticated
  using (true);

drop policy if exists "authenticated_read_fluig_supplier_candidates" on public.fluig_supplier_candidates;
create policy "authenticated_read_fluig_supplier_candidates"
  on public.fluig_supplier_candidates for select
  to authenticated
  using (true);

drop policy if exists "authenticated_read_fluig_supplier_links" on public.fluig_supplier_links;
create policy "authenticated_read_fluig_supplier_links"
  on public.fluig_supplier_links for select
  to authenticated
  using (true);

revoke insert, update, delete on public.fluig_process_mappings from authenticated;
revoke insert, update, delete on public.fluig_requests from authenticated;
revoke insert, update, delete on public.fluig_request_events from authenticated;
revoke insert, update, delete on public.fluig_operation_runs from authenticated;
revoke insert, update, delete on public.fluig_supplier_candidates from authenticated;
revoke insert, update, delete on public.fluig_supplier_links from authenticated;
