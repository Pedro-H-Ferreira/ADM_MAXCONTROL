create or replace function public.reconcile_fluig_supplier_relations(
  p_supplier_ids uuid[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request_links integer := 0;
  v_candidate_links integer := 0;
  v_branch_links integer := 0;
  v_candidates_in_review integer := 0;
begin
  with target_suppliers as (
    select supplier.id, supplier.cnpj_normalizado
    from public.app_suppliers supplier
    where supplier.deleted_at is null
      and supplier.cnpj_normalizado is not null
      and (p_supplier_ids is null or supplier.id = any(p_supplier_ids))
  ),
  matched as (
    select request.id as request_id, supplier.id as supplier_id
    from public.fluig_requests request
    join target_suppliers supplier
      on char_length(regexp_replace(coalesce(request.supplier_cnpj, ''), '[^0-9]', '', 'g')) between 8 and 14
     and lpad(regexp_replace(request.supplier_cnpj, '[^0-9]', '', 'g'), 14, '0') = supplier.cnpj_normalizado
  )
  update public.fluig_requests request
  set app_supplier_id = matched.supplier_id
  from matched
  where request.id = matched.request_id
    and request.app_supplier_id is distinct from matched.supplier_id;
  get diagnostics v_request_links = row_count;

  with target_suppliers as (
    select supplier.id, supplier.cnpj_normalizado, supplier.razao_social
    from public.app_suppliers supplier
    where supplier.deleted_at is null
      and supplier.cnpj_normalizado is not null
      and (p_supplier_ids is null or supplier.id = any(p_supplier_ids))
  ),
  matched_candidates as (
    select
      candidate.id as candidate_id,
      supplier.id as supplier_id,
      supplier.cnpj_normalizado,
      supplier.razao_social,
      candidate.fluig_name,
      candidate.fluig_code,
      candidate.source_request_ids,
      candidate.suggested_defaults
    from public.fluig_supplier_candidates candidate
    join target_suppliers supplier
      on char_length(regexp_replace(coalesce(candidate.cnpj, ''), '[^0-9]', '', 'g')) between 8 and 14
     and lpad(regexp_replace(candidate.cnpj, '[^0-9]', '', 'g'), 14, '0') = supplier.cnpj_normalizado
    where candidate.status <> 'IGNORADO'
  )
  insert into public.fluig_supplier_links (
    candidate_id,
    app_supplier_id,
    adm_supplier_id,
    supplier_name,
    cnpj,
    fluig_name,
    fluig_code,
    default_source_request_id,
    default_payload,
    active
  )
  select
    candidate_id,
    supplier_id,
    supplier_id,
    razao_social,
    cnpj_normalizado,
    fluig_name,
    fluig_code,
    source_request_ids[1],
    coalesce(suggested_defaults, '{}'::jsonb),
    true
  from matched_candidates
  on conflict (candidate_id) where candidate_id is not null
  do update set
    app_supplier_id = excluded.app_supplier_id,
    adm_supplier_id = excluded.adm_supplier_id,
    supplier_name = excluded.supplier_name,
    cnpj = excluded.cnpj,
    fluig_name = excluded.fluig_name,
    fluig_code = excluded.fluig_code,
    default_source_request_id = excluded.default_source_request_id,
    default_payload = excluded.default_payload,
    active = true,
    updated_at = now();
  get diagnostics v_candidate_links = row_count;

  update public.fluig_supplier_candidates candidate
  set status = 'EM_REVISAO',
      updated_at = now()
  from public.app_suppliers supplier
  where supplier.deleted_at is null
    and supplier.cnpj_normalizado is not null
    and (p_supplier_ids is null or supplier.id = any(p_supplier_ids))
    and candidate.status = 'PRE_CADASTRO'
    and char_length(regexp_replace(coalesce(candidate.cnpj, ''), '[^0-9]', '', 'g')) between 8 and 14
    and lpad(regexp_replace(candidate.cnpj, '[^0-9]', '', 'g'), 14, '0') = supplier.cnpj_normalizado;
  get diagnostics v_candidates_in_review = row_count;

  update public.app_supplier_branch_links link
  set default_branch = false
  where link.metadata ->> 'source' = 'fluig_history_reconciliation'
    and (p_supplier_ids is null or link.supplier_id = any(p_supplier_ids));

  with usage_counts as (
    select
      request.app_supplier_id as supplier_id,
      branch.id as branch_id,
      count(*)::integer as usage_count,
      max(request.last_synced_at) as last_seen_at
    from public.fluig_requests request
    join public.app_branches branch
      on branch.deleted_at is null
     and branch.active is true
     and branch.code = coalesce(
       nullif(btrim(request.branch_code), ''),
       substring(coalesce(request.branch_label, '') from '^\s*([A-Za-z0-9._-]+)')
     )
    where request.app_supplier_id is not null
      and (p_supplier_ids is null or request.app_supplier_id = any(p_supplier_ids))
    group by request.app_supplier_id, branch.id
  ),
  ranked_usage as (
    select
      usage_counts.*,
      row_number() over (
        partition by usage_counts.supplier_id
        order by usage_counts.usage_count desc, usage_counts.last_seen_at desc nulls last, usage_counts.branch_id
      ) = 1 as is_default
    from usage_counts
  )
  insert into public.app_supplier_branch_links (
    supplier_id,
    branch_id,
    default_branch,
    metadata
  )
  select
    supplier_id,
    branch_id,
    is_default,
    jsonb_build_object(
      'source', 'fluig_history_reconciliation',
      'usageCount', usage_count,
      'lastSeenAt', last_seen_at
    )
  from ranked_usage
  on conflict (supplier_id, branch_id)
  do update set
    default_branch = case
      when public.app_supplier_branch_links.metadata ->> 'source' = 'fluig_history_reconciliation'
        then excluded.default_branch
      else public.app_supplier_branch_links.default_branch
    end,
    metadata = case
      when public.app_supplier_branch_links.metadata ->> 'source' = 'fluig_history_reconciliation'
        then excluded.metadata
      else public.app_supplier_branch_links.metadata || jsonb_build_object('fluigHistory', excluded.metadata)
    end;
  get diagnostics v_branch_links = row_count;

  return jsonb_build_object(
    'requestLinks', v_request_links,
    'candidateLinks', v_candidate_links,
    'branchLinks', v_branch_links,
    'candidatesInReview', v_candidates_in_review
  );
end;
$$;

revoke all on function public.reconcile_fluig_supplier_relations(uuid[]) from public;
revoke all on function public.reconcile_fluig_supplier_relations(uuid[]) from anon;
revoke all on function public.reconcile_fluig_supplier_relations(uuid[]) from authenticated;
grant execute on function public.reconcile_fluig_supplier_relations(uuid[]) to service_role;
