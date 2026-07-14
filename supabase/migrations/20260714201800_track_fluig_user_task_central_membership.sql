alter table public.fluig_requests
  add column if not exists open_task_fluig_user_id text,
  add column if not exists my_request_fluig_user_id text,
  add column if not exists last_seen_in_user_task_list_at timestamptz,
  add column if not exists last_seen_in_user_request_list_at timestamptz;

create index if not exists fluig_requests_open_task_user_open_idx
  on public.fluig_requests (open_task_fluig_user_id, is_open, last_seen_in_user_task_list_at desc)
  where open_task_fluig_user_id is not null;

create index if not exists fluig_requests_my_request_user_open_idx
  on public.fluig_requests (my_request_fluig_user_id, is_open, last_seen_in_user_request_list_at desc)
  where my_request_fluig_user_id is not null;

comment on column public.fluig_requests.open_task_fluig_user_id is
  'Codigo do colaborador retornado por findWorkflowTasks para a ultima lista sincronizada.';

comment on column public.fluig_requests.my_request_fluig_user_id is
  'Codigo do colaborador retornado por findMyRequests para a ultima lista sincronizada.';

update public.app_user_profiles
set
  fluig_user_id = '00130',
  updated_at = now()
where fluig_user_id = '132'
  and lower(coalesce(fluig_username, email, '')) in (
    'administrativo@dvaatacados.com.br',
    'administrativo.dvaatacados.com.br.1'
  );
