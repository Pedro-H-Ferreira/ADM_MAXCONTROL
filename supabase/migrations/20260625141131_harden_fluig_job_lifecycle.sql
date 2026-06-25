alter table public.fluig_jobs
  add column if not exists max_attempts smallint not null default 3,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz;

alter table public.fluig_jobs
  drop constraint if exists fluig_jobs_max_attempts_check;

alter table public.fluig_jobs
  add constraint fluig_jobs_max_attempts_check
  check (max_attempts between 1 and 10);

update public.fluig_jobs
set max_attempts = case
  when operation in ('open_from_source', 'cancel_request') then 1
  when operation = 'health_check' then 2
  else 3
end;

update public.fluig_jobs
set
  status = 'expired',
  progress_stage = 'expired',
  progress_label = 'Job expirou aguardando um agente local online. Inicie o agente e tente novamente.',
  error_message = 'Job expirou aguardando um agente local online.',
  finished_at = coalesce(finished_at, now()),
  updated_at = now()
where status = 'queued'
  and expires_at <= now();

create index if not exists fluig_jobs_dispatch_idx
  on public.fluig_jobs (requested_by_user_id, status, next_attempt_at, priority, created_at);

create index if not exists fluig_jobs_active_lease_idx
  on public.fluig_jobs (requested_by_user_id, status, updated_at)
  where status in (
    'agent_claimed',
    'authenticating',
    'opening_fluig',
    'reading_page',
    'filling_form',
    'submitting',
    'waiting_protocol',
    'syncing_result'
  );
