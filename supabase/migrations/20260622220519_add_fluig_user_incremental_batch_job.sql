alter table public.fluig_jobs
  drop constraint if exists fluig_jobs_operation_check;

alter table public.fluig_jobs
  add constraint fluig_jobs_operation_check
  check (
    operation in (
      'sync_history',
      'sync_status',
      'open_from_source',
      'cancel_request',
      'health_check',
      'sync_initial_history',
      'sync_user_open_tasks',
      'sync_user_open_requests',
      'sync_user_incremental_batch',
      'sync_request_by_number',
      'supplier_lookup_by_cnpj'
    )
  );
