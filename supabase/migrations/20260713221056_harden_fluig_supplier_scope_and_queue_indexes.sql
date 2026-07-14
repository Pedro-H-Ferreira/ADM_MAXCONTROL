drop policy if exists "authenticated_read_fluig_supplier_links" on public.fluig_supplier_links;

revoke select on table public.fluig_supplier_links from anon, authenticated;
grant select on table public.fluig_supplier_links to service_role;

-- Rollback seguro (apos policy escopada): grant select on table public.fluig_supplier_links to authenticated;

create index if not exists fluig_requests_open_queue_status_check_idx
  on public.fluig_requests (
    module_slug,
    last_status_check_at asc nulls first,
    last_synced_at desc nulls last
  )
  where is_open is true
    and fluig_request_id is not null;

-- Rollback seguro: drop index if exists public.fluig_requests_open_queue_status_check_idx;
