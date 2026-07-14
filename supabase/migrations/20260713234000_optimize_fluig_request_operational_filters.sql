create extension if not exists pg_trgm with schema extensions;

create index if not exists fluig_requests_operational_page_idx
  on public.fluig_requests (
    module_slug,
    is_open,
    normalized_status,
    last_status_check_at desc nulls last,
    last_synced_at desc nulls last
  )
  where fluig_request_id is not null;

create index if not exists fluig_requests_operational_branch_idx
  on public.fluig_requests (
    module_slug,
    branch_code,
    is_open,
    last_synced_at desc nulls last
  )
  where fluig_request_id is not null;

create index if not exists fluig_requests_operational_due_idx
  on public.fluig_requests (module_slug, due_date asc)
  where is_open is true
    and due_date is not null
    and fluig_request_id is not null;

create index if not exists fluig_requests_number_trgm_idx
  on public.fluig_requests using gin (fluig_request_id extensions.gin_trgm_ops);

create index if not exists fluig_requests_adm_reference_trgm_idx
  on public.fluig_requests using gin (adm_reference extensions.gin_trgm_ops);

create index if not exists fluig_requests_supplier_name_trgm_idx
  on public.fluig_requests using gin (supplier_name extensions.gin_trgm_ops);

create index if not exists fluig_requests_supplier_cnpj_trgm_idx
  on public.fluig_requests using gin (supplier_cnpj extensions.gin_trgm_ops);

create index if not exists fluig_requests_requester_trgm_idx
  on public.fluig_requests using gin (requester extensions.gin_trgm_ops);

create index if not exists fluig_requests_current_task_trgm_idx
  on public.fluig_requests using gin (current_task extensions.gin_trgm_ops);

create index if not exists fluig_requests_task_owner_trgm_idx
  on public.fluig_requests using gin (task_owner extensions.gin_trgm_ops);

-- Rollback seguro: remover apenas os indices *_operational_* e *_trgm_idx criados acima.
