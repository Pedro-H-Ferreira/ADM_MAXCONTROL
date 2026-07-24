create or replace function public.list_fluig_form_field_keys(p_module_slug text)
returns table (
  field_key text,
  occurrence_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with discovered_fields as (
    select request.id as request_id,
      jsonb_object_keys(coalesce(request.raw_payload -> 'formFields', '{}'::jsonb)) as field_key
    from public.fluig_requests as request
    where request.module_slug = p_module_slug

    union

    select request.id as request_id,
      jsonb_object_keys(coalesce(request.detail_snapshot -> 'formFields', '{}'::jsonb)) as field_key
    from public.fluig_requests as request
    where request.module_slug = p_module_slug
  )
  select
    btrim(discovered_fields.field_key) as field_key,
    count(distinct discovered_fields.request_id)::bigint as occurrence_count
  from discovered_fields
  where btrim(discovered_fields.field_key) <> ''
  group by btrim(discovered_fields.field_key)
  order by btrim(discovered_fields.field_key);
$$;

revoke all on function public.list_fluig_form_field_keys(text) from public, anon, authenticated;
grant execute on function public.list_fluig_form_field_keys(text) to service_role;

comment on function public.list_fluig_form_field_keys(text) is
  'Lista todas as chaves de formulario ja observadas nas solicitacoes Fluig sincronizadas por modulo.';
