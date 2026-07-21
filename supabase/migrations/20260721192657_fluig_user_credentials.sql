create table if not exists public.fluig_user_credentials (
  user_id uuid primary key references public.app_user_profiles(id) on delete cascade,
  username_ciphertext text not null,
  password_ciphertext text not null,
  cipher_version smallint not null default 1 check (cipher_version = 1),
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  last_tested_at timestamptz,
  last_test_status text check (last_test_status in ('success', 'error')),
  last_test_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fluig_user_credentials enable row level security;

drop trigger if exists set_fluig_user_credentials_updated_at on public.fluig_user_credentials;
create trigger set_fluig_user_credentials_updated_at
  before update on public.fluig_user_credentials
  for each row execute function public.set_updated_at();

revoke all on table public.fluig_user_credentials from public, anon, authenticated;
grant select, insert, update, delete on table public.fluig_user_credentials to service_role;

create or replace function public.claim_next_fluig_server_job()
returns setof public.fluig_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.fluig_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select j.*
  into v_job
  from public.fluig_jobs j
  join public.app_user_profiles p on p.id = j.requested_by_user_id
  join public.fluig_user_credentials c on c.user_id = j.requested_by_user_id
  where j.status = 'queued'
    and j.assigned_agent_id is null
    and j.expires_at > v_now
    and j.next_attempt_at <= v_now
    and p.active
    and p.approval_status = 'APPROVED'
    and not exists (
      select 1
      from public.fluig_jobs active_job
      where active_job.assigned_agent_id is null
        and active_job.status in (
          'agent_claimed', 'authenticating', 'opening_fluig', 'reading_page',
          'filling_form', 'submitting', 'waiting_protocol', 'syncing_result'
        )
    )
  order by j.priority, j.created_at, j.id
  limit 1
  for update of j skip locked;

  if not found then
    return;
  end if;

  update public.fluig_jobs
  set status = 'agent_claimed',
      claimed_at = v_now,
      started_at = coalesce(started_at, v_now),
      progress_stage = 'agent_claimed',
      progress_label = 'Executor interno da VPS assumiu a tarefa.',
      attempts = attempts + 1,
      last_attempt_at = v_now,
      updated_at = v_now
  where id = v_job.id
    and status = 'queued'
    and assigned_agent_id is null
  returning * into v_job;

  if not found then
    return;
  end if;

  insert into public.fluig_job_events (
    job_id, agent_id, event_type, stage, label, event_payload
  ) values (
    v_job.id,
    null,
    'server_claimed',
    'agent_claimed',
    'Executor interno da VPS assumiu a tarefa.',
    jsonb_build_object('attempt', v_job.attempts, 'executor', 'vps_internal')
  );

  return next v_job;
end;
$$;

create or replace function public.transition_fluig_server_job(
  p_job_id uuid,
  p_event_type text,
  p_stage text default null,
  p_label text default null,
  p_status text default null,
  p_event_payload jsonb default '{}'::jsonb
)
returns setof public.fluig_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.fluig_jobs%rowtype;
begin
  if p_status is not null and p_status not in (
    'agent_claimed', 'authenticating', 'opening_fluig', 'reading_page',
    'filling_form', 'submitting', 'waiting_protocol', 'syncing_result'
  ) then
    raise exception 'Status de progresso Fluig invalido: %', p_status;
  end if;

  update public.fluig_jobs
  set status = coalesce(p_status, status),
      progress_stage = coalesce(nullif(p_stage, ''), progress_stage),
      progress_label = coalesce(nullif(p_label, ''), progress_label),
      updated_at = clock_timestamp()
  where id = p_job_id
    and assigned_agent_id is null
    and status in (
      'agent_claimed', 'authenticating', 'opening_fluig', 'reading_page',
      'filling_form', 'submitting', 'waiting_protocol', 'syncing_result'
    )
  returning * into v_job;

  if not found then
    return;
  end if;

  insert into public.fluig_job_events (
    job_id, agent_id, event_type, stage, label, event_payload
  ) values (
    p_job_id, null, p_event_type, p_stage, p_label, coalesce(p_event_payload, '{}'::jsonb)
  );

  return next v_job;
end;
$$;

create or replace function public.complete_fluig_server_job(
  p_job_id uuid,
  p_status text,
  p_result_payload jsonb default '{}'::jsonb,
  p_error_message text default null
)
returns setof public.fluig_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.fluig_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_label text;
begin
  if p_status not in ('success', 'error', 'cancelled') then
    raise exception 'Status terminal Fluig invalido: %', p_status;
  end if;

  v_label := case
    when p_status = 'success' then 'Tarefa finalizada com sucesso pela VPS.'
    else coalesce(nullif(p_error_message, ''), 'Tarefa finalizada com erro na VPS.')
  end;

  update public.fluig_jobs
  set status = p_status,
      result_payload = coalesce(p_result_payload, '{}'::jsonb),
      error_message = nullif(p_error_message, ''),
      progress_stage = p_status,
      progress_label = v_label,
      finished_at = v_now,
      updated_at = v_now
  where id = p_job_id
    and assigned_agent_id is null
    and status in (
      'agent_claimed', 'authenticating', 'opening_fluig', 'reading_page',
      'filling_form', 'submitting', 'waiting_protocol', 'syncing_result'
    )
  returning * into v_job;

  if not found then
    return;
  end if;

  insert into public.fluig_job_events (
    job_id, agent_id, event_type, stage, label, event_payload
  ) values (
    p_job_id, null, p_status, p_status, v_label, coalesce(p_result_payload, '{}'::jsonb)
  );

  return next v_job;
end;
$$;

revoke execute on function public.claim_next_fluig_server_job() from public, anon, authenticated;
revoke execute on function public.transition_fluig_server_job(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.complete_fluig_server_job(uuid, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.claim_next_fluig_server_job() to service_role;
grant execute on function public.transition_fluig_server_job(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.complete_fluig_server_job(uuid, text, jsonb, text) to service_role;
