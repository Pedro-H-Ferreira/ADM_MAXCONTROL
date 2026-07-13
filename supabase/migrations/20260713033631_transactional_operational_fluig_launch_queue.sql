create or replace function public.enqueue_operational_fluig_launch(
  p_launch_id uuid,
  p_actor_user_id uuid,
  p_request_payload jsonb default '{}'::jsonb
)
returns setof public.fluig_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_launch public.app_fluig_launches%rowtype;
  v_profile public.app_user_profiles%rowtype;
  v_job public.fluig_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_payload jsonb;
begin
  select launch.*
  into v_launch
  from public.app_fluig_launches launch
  where launch.id = p_launch_id
    and launch.created_by_user_id = p_actor_user_id
    and launch.deleted_at is null
  for update;

  if not found then
    raise exception 'Lancamento operacional nao encontrado para este usuario.';
  end if;

  select profile.*
  into v_profile
  from public.app_user_profiles profile
  where profile.id = p_actor_user_id
    and profile.active
    and profile.approval_status = 'APPROVED';

  if not found then
    raise exception 'Usuario inativo ou ainda nao aprovado.';
  end if;

  if v_launch.fluig_job_id is not null
     and v_launch.status in ('NA_FILA', 'EM_EXECUCAO', 'ABERTO_NO_FLUIG') then
    select job.*
    into v_job
    from public.fluig_jobs job
    where job.id = v_launch.fluig_job_id;

    if found then
      return next v_job;
      return;
    end if;
  end if;

  if v_launch.status not in ('VALIDADO', 'ERRO') then
    raise exception 'Este lancamento ja foi enviado, concluido ou cancelado.';
  end if;

  if v_profile.role not in ('ADMIN_MASTER', 'ADMIN') then
    if v_launch.branch_id is null or not exists (
      select 1
      from public.app_user_branch_access access
      where access.user_id = p_actor_user_id
        and access.branch_id = v_launch.branch_id
        and access.can_view
        and access.can_create
    ) then
      raise exception 'Usuario sem permissao para criar lancamentos nesta filial.';
    end if;
  end if;

  if not exists (
    select 1
    from public.fluig_user_agents agent
    where agent.user_id = p_actor_user_id
      and agent.status = 'online'
      and agent.last_heartbeat_at >= v_now - interval '2 minutes'
  ) then
    raise exception 'Nenhum agente Fluig online esta pareado com este usuario. Inicie o agente local e tente novamente.';
  end if;

  perform public.reconcile_fluig_job_lifecycle(p_actor_user_id);

  v_payload := coalesce(p_request_payload, '{}'::jsonb) || jsonb_build_object(
    'launchId', v_launch.id::text,
    'sourceRequestId', v_launch.source_request_id,
    'fieldOverrides', v_launch.field_overrides
  );

  insert into public.fluig_jobs (
    requested_by_user_id,
    module_slug,
    operation,
    status,
    branch_id,
    branch_code,
    branch_label,
    fluig_username,
    request_payload,
    progress_stage,
    progress_label,
    max_attempts,
    next_attempt_at,
    expires_at
  ) values (
    p_actor_user_id,
    v_launch.module_slug,
    'open_from_source',
    'queued',
    v_launch.branch_id,
    v_launch.branch_code,
    v_launch.branch_label,
    v_profile.fluig_username,
    v_payload,
    'queued',
    'Aguardando agente local.',
    1,
    v_now,
    v_now + interval '1 hour'
  )
  returning * into v_job;

  update public.app_fluig_launches
  set status = 'NA_FILA',
      fluig_job_id = v_job.id,
      progress_stage = 'queued',
      progress_label = 'Aguardando agente local.',
      last_error_message = null,
      queued_at = v_now,
      failed_at = null,
      updated_by_user_id = p_actor_user_id
  where id = v_launch.id;

  insert into public.app_fluig_launch_events (
    launch_id,
    actor_user_id,
    event_type,
    event_label,
    status_from,
    status_to,
    event_payload
  ) values (
    v_launch.id,
    p_actor_user_id,
    'queued',
    'Lancamento enviado para a fila do agente Fluig.',
    v_launch.status,
    'NA_FILA',
    jsonb_build_object('jobId', v_job.id)
  );

  return next v_job;
end;
$$;

revoke execute on function public.enqueue_operational_fluig_launch(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_operational_fluig_launch(uuid, uuid, jsonb)
  to service_role;
