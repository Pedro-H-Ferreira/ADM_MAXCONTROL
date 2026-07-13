create or replace function public.reconcile_fluig_job_lifecycle(p_user_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.fluig_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_lease interval;
  v_retry_delay interval;
  v_new_expires_at timestamptz;
  v_label text;
  v_expired integer := 0;
  v_retried integer := 0;
begin
  for v_job in
    select j.*
    from public.fluig_jobs j
    where (p_user_id is null or j.requested_by_user_id = p_user_id)
      and j.status in (
        'queued', 'agent_claimed', 'authenticating', 'opening_fluig',
        'reading_page', 'filling_form', 'submitting',
        'waiting_protocol', 'syncing_result'
      )
      and (
        (j.status = 'queued' and j.expires_at <= v_now)
        or
        (j.status <> 'queued' and j.updated_at <= v_now - case
          when j.operation in ('sync_history', 'sync_initial_history', 'supplier_lookup_by_cnpj') then interval '30 minutes'
          when j.operation = 'open_from_source' then interval '20 minutes'
          else interval '15 minutes'
        end)
      )
    order by j.created_at
    limit 500
    for update skip locked
  loop
    if v_job.status = 'queued' then
      v_label := 'Job expirou aguardando um agente local online. Inicie o agente e tente novamente.';
    elsif v_job.attempts >= v_job.max_attempts then
      v_label := format(
        'Execucao interrompida sem retorno do agente apos %s tentativa(s).%s',
        v_job.attempts,
        case
          when v_job.operation in ('open_from_source', 'cancel_request')
            then ' O reenvio automatico foi bloqueado para evitar duplicidade; confira o Fluig antes de tentar novamente.'
          else ''
        end
      );
    else
      v_retry_delay := least(
        interval '5 minutes',
        interval '30 seconds' * power(2, greatest(0, least(v_job.attempts - 1, 4)))
      );
      v_new_expires_at := v_now + case
        when v_job.operation in ('sync_history', 'sync_initial_history', 'supplier_lookup_by_cnpj') then interval '6 hours'
        when v_job.operation = 'sync_user_incremental_batch' then interval '2 hours'
        when v_job.operation in ('open_from_source', 'cancel_request') then interval '1 hour'
        when v_job.operation = 'health_check' then interval '15 minutes'
        else interval '90 minutes'
      end;
      v_label := format(
        'Agente interrompeu a execucao. Nova tentativa %s/%s agendada automaticamente.',
        v_job.attempts + 1,
        v_job.max_attempts
      );

      update public.fluig_jobs
      set assigned_agent_id = null,
          status = 'queued',
          progress_stage = 'queued',
          progress_label = v_label,
          error_message = null,
          claimed_at = null,
          started_at = null,
          finished_at = null,
          next_attempt_at = v_now + v_retry_delay,
          expires_at = v_new_expires_at,
          updated_at = v_now
      where id = v_job.id;

      insert into public.fluig_job_events (
        job_id, agent_id, event_type, stage, label, event_payload
      ) values (
        v_job.id,
        v_job.assigned_agent_id,
        'retry_scheduled',
        'queued',
        v_label,
        jsonb_build_object(
          'attempts', v_job.attempts,
          'maxAttempts', v_job.max_attempts,
          'nextAttemptAt', v_now + v_retry_delay
        )
      );
      v_retried := v_retried + 1;
      continue;
    end if;

    update public.fluig_jobs
    set status = 'expired',
        progress_stage = 'expired',
        progress_label = v_label,
        error_message = v_label,
        finished_at = coalesce(finished_at, v_now),
        updated_at = v_now
    where id = v_job.id;

    insert into public.fluig_job_events (
      job_id, agent_id, event_type, stage, label, event_payload
    ) values (
      v_job.id,
      v_job.assigned_agent_id,
      'expired',
      'expired',
      v_label,
      jsonb_build_object('attempts', v_job.attempts, 'maxAttempts', v_job.max_attempts)
    );

    update public.fluig_user_sync_state
    set last_sync_at = v_now,
        last_error_at = v_now,
        last_error_message = v_label,
        metadata = metadata || jsonb_build_object('jobLifecycleStatus', 'expired'),
        updated_at = v_now
    where metadata ->> 'jobId' = v_job.id::text;

    if coalesce(v_job.request_payload ->> 'supplierId', '') <> '' then
      update public.app_suppliers
      set sync_status = 'ERRO_SYNC',
          last_fluig_sync_at = v_now,
          updated_by_user_id = v_job.requested_by_user_id,
          updated_at = v_now
      where id::text = v_job.request_payload ->> 'supplierId';
    end if;

    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object('expired', v_expired, 'retried', v_retried);
end;
$$;

create or replace function public.claim_next_fluig_job(p_agent_id uuid)
returns setof public.fluig_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_job public.fluig_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select a.user_id
  into v_user_id
  from public.fluig_user_agents a
  join public.app_user_profiles p on p.id = a.user_id
  where a.id = p_agent_id
    and a.status = 'online'
    and a.last_heartbeat_at >= v_now - interval '2 minutes'
    and p.active
    and p.approval_status = 'APPROVED';

  if v_user_id is null then
    return;
  end if;

  perform public.reconcile_fluig_job_lifecycle(v_user_id);

  select j.*
  into v_job
  from public.fluig_jobs j
  where j.assigned_agent_id = p_agent_id
    and j.requested_by_user_id = v_user_id
    and j.status in (
      'agent_claimed', 'authenticating', 'opening_fluig', 'reading_page',
      'filling_form', 'submitting', 'waiting_protocol', 'syncing_result'
    )
  order by j.created_at
  limit 1
  for update skip locked;

  if found then
    return next v_job;
    return;
  end if;

  select j.*
  into v_job
  from public.fluig_jobs j
  where j.requested_by_user_id = v_user_id
    and j.status = 'queued'
    and j.expires_at > v_now
    and j.next_attempt_at <= v_now
  order by j.priority, j.created_at, j.id
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.fluig_jobs
  set assigned_agent_id = p_agent_id,
      status = 'agent_claimed',
      claimed_at = v_now,
      started_at = coalesce(started_at, v_now),
      progress_stage = 'agent_claimed',
      progress_label = 'Agente local assumiu a tarefa.',
      attempts = attempts + 1,
      last_attempt_at = v_now,
      updated_at = v_now
  where id = v_job.id
  returning * into v_job;

  insert into public.fluig_job_events (
    job_id, agent_id, event_type, stage, label, event_payload
  ) values (
    v_job.id,
    p_agent_id,
    'agent_claimed',
    'agent_claimed',
    'Agente local assumiu a tarefa.',
    jsonb_build_object('attempt', v_job.attempts)
  );

  return next v_job;
end;
$$;

create or replace function public.transition_fluig_job(
  p_job_id uuid,
  p_agent_id uuid,
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
    and assigned_agent_id = p_agent_id
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
    p_job_id, p_agent_id, p_event_type, p_stage, p_label, coalesce(p_event_payload, '{}'::jsonb)
  );

  return next v_job;
end;
$$;

create or replace function public.complete_fluig_job(
  p_job_id uuid,
  p_agent_id uuid,
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
    when p_status = 'success' then 'Tarefa finalizada com sucesso.'
    else coalesce(nullif(p_error_message, ''), 'Tarefa finalizada com erro.')
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
    and assigned_agent_id = p_agent_id
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
    p_job_id, p_agent_id, p_status, p_status, v_label, coalesce(p_result_payload, '{}'::jsonb)
  );

  return next v_job;
end;
$$;

revoke execute on function public.reconcile_fluig_job_lifecycle(uuid) from public, anon, authenticated;
revoke execute on function public.claim_next_fluig_job(uuid) from public, anon, authenticated;
revoke execute on function public.transition_fluig_job(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.complete_fluig_job(uuid, uuid, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.reconcile_fluig_job_lifecycle(uuid) to service_role;
grant execute on function public.claim_next_fluig_job(uuid) to service_role;
grant execute on function public.transition_fluig_job(uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.complete_fluig_job(uuid, uuid, text, jsonb, text) to service_role;
