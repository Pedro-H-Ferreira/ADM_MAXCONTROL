create extension if not exists "unaccent";

with source_requests as (
  select
    module_slug,
    fluig_request_id,
    branch_code,
    coalesce(last_synced_at, opened_at, created_at, now()) as seen_at,
    raw_payload->'formFields' as fields
  from public.fluig_requests
  where raw_payload ? 'formFields'
),
catalog_source as (
  select
    'natureza'::text as catalog_type,
    module_slug,
    coalesce(
      fields->>'codigonaturezaC',
      fields->>'naturezaSalva',
      fields->>'natureza',
      fields->>'codNatureza'
    ) as label,
    fluig_request_id,
    branch_code,
    seen_at
  from source_requests
  union all
  select
    'cost_center',
    module_slug,
    coalesce(
      fields->>'centroCusto',
      fields->>'codCentroCusto',
      fields->>'centroDeCusto'
    ) as label,
    fluig_request_id,
    branch_code,
    seen_at
  from source_requests
  union all
  select
    'payment_method',
    module_slug,
    fields->>'formaPagamento' as label,
    fluig_request_id,
    branch_code,
    seen_at
  from source_requests
  union all
  select
    'account',
    module_slug,
    coalesce(fields->>'contaCentroCusto', fields->>'contaContabil') as label,
    fluig_request_id,
    branch_code,
    seen_at
  from source_requests
),
normalized_catalog as (
  select
    catalog_type,
    module_slug,
    nullif(
      case
        when trim(label) ~ '^[A-Za-z0-9._-]+[[:space:]]*-' then regexp_replace(trim(label), '^([A-Za-z0-9._-]+)[[:space:]]*-.*$', '\1')
        else ''
      end,
      ''
    ) as code,
    trim(regexp_replace(label, '[[:space:]]+', ' ', 'g')) as label,
    upper(regexp_replace(unaccent(trim(regexp_replace(label, '[[:space:]]+', ' ', 'g'))), '[^a-zA-Z0-9]+', ' ', 'g')) as normalized_label,
    fluig_request_id,
    branch_code,
    seen_at
  from catalog_source
  where nullif(trim(coalesce(label, '')), '') is not null
    and lower(trim(label)) not like '[object%'
)
insert into public.fluig_catalog_items (
  catalog_key,
  catalog_type,
  module_slug,
  code,
  label,
  value,
  normalized_label,
  occurrence_count,
  source_request_id,
  metadata,
  last_seen_at
)
select
  concat_ws(':', catalog_type, module_slug, coalesce(code, '*'), normalized_label) as catalog_key,
  catalog_type,
  module_slug,
  code,
  label,
  label,
  normalized_label,
  count(*)::integer,
  max(fluig_request_id),
  jsonb_build_object('source', 'fluig_requests_form_fields_seed', 'branchCode', nullif(max(branch_code), '')),
  max(seen_at)
from normalized_catalog
group by catalog_type, module_slug, code, label, normalized_label
on conflict (catalog_key) do update
set occurrence_count = excluded.occurrence_count,
    source_request_id = excluded.source_request_id,
    metadata = excluded.metadata,
    last_seen_at = excluded.last_seen_at,
    updated_at = now();
