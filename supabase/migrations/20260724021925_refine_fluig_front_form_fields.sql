drop function if exists public.list_fluig_form_field_keys(text);

create function public.list_fluig_form_field_keys(p_module_slug text)
returns table (
  field_key text,
  occurrence_count bigint,
  sample_value text
)
language sql
stable
security invoker
set search_path = public
as $$
  with discovered_values as (
    select
      request.id as request_id,
      btrim(entry.key) as field_key,
      nullif(btrim(entry.value #>> '{}'), '') as field_value,
      coalesce(request.last_synced_at, request.opened_at, request.created_at) as observed_at
    from public.fluig_requests as request
    cross join lateral jsonb_each(coalesce(request.raw_payload -> 'formFields', '{}'::jsonb)) as entry
    where request.module_slug = p_module_slug

    union all

    select
      request.id as request_id,
      btrim(entry.key) as field_key,
      nullif(btrim(entry.value #>> '{}'), '') as field_value,
      coalesce(request.detail_synced_at, request.last_synced_at, request.opened_at, request.created_at) as observed_at
    from public.fluig_requests as request
    cross join lateral jsonb_each(coalesce(request.detail_snapshot -> 'formFields', '{}'::jsonb)) as entry
    where request.module_slug = p_module_slug
  ),
  front_values as (
    select distinct on (request_id, field_key)
      request_id,
      field_key,
      field_value,
      observed_at
    from discovered_values
    where field_key <> ''
      and field_value is not null
      and lower(split_part(field_key, '___', 1)) not in (
        'anonymization_date',
        'cardid',
        'companyid',
        'documentid',
        'masterid',
        'tableid',
        'version'
      )
    order by request_id, field_key, observed_at desc nulls last
  )
  select
    front_values.field_key,
    count(distinct front_values.request_id)::bigint as occurrence_count,
    left(
      (array_agg(front_values.field_value order by front_values.observed_at desc nulls last))[1],
      160
    ) as sample_value
  from front_values
  group by front_values.field_key
  order by front_values.field_key;
$$;

revoke all on function public.list_fluig_form_field_keys(text) from public, anon, authenticated;
grant execute on function public.list_fluig_form_field_keys(text) to service_role;

comment on function public.list_fluig_form_field_keys(text) is
  'Lista somente campos preenchidos do formulario Fluig, exclui metadados tecnicos e retorna um exemplo recente.';
