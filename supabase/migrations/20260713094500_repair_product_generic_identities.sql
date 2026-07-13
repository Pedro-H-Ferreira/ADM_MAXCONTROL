create or replace function public.is_generic_product_description(
  p_name text,
  p_description text,
  p_specification text
)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select coalesce(
    public.normalize_product_catalog_text(p_name) in (
      'DESCRICAO ACIMA', 'NA DESCRICAO', 'EM ANEXO', 'PEDIDO EM ANEXO', 'TESTE', 'ANEXO'
    )
    or public.normalize_product_catalog_text(p_name) like '% EM ANEXO'
    or (
      public.normalize_product_catalog_text(p_name) in ('EPI', 'MANUTENCAO')
      and public.normalize_product_catalog_text(p_specification) is null
    ),
    false
  );
$$;

create temporary table product_identity_repairs on commit drop as
with expected as (
  select
    occurrence.id as occurrence_id,
    product.id as product_id,
    case
      when public.is_generic_product_description(
        product.name,
        product.description,
        product.specification
      ) then concat(
        'OCCURRENCE:',
        occurrence.fluig_request_id::text,
        ':',
        occurrence.source_table,
        ':',
        occurrence.source_row_index::text
      )
      else encode(
        extensions.digest(
          convert_to('v1', 'UTF8')
          || decode('00', 'hex')
          || convert_to(coalesce(product.normalized_name, ''), 'UTF8')
          || decode('00', 'hex')
          || convert_to(coalesce(product.normalized_specification, ''), 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    end as expected_dedupe_key
  from public.app_product_occurrences occurrence
  join public.app_products product on product.id = occurrence.product_id
  where product.source_system = 'FLUIG'
    and product.deleted_at is null
)
select expected.*
from expected
join public.app_products product on product.id = expected.product_id
where product.dedupe_key <> expected.expected_dedupe_key
  and not exists (
    select 1
    from public.app_products conflict
    where conflict.source_system = product.source_system
      and conflict.dedupe_key = expected.expected_dedupe_key
      and conflict.id <> product.id
  );

alter table public.app_products disable trigger set_app_product_normalized_fields;

update public.app_products product
set dedupe_key = repair.expected_dedupe_key,
    updated_at = clock_timestamp()
from (
  select product_id, min(expected_dedupe_key) as expected_dedupe_key
  from product_identity_repairs
  group by product_id
  having count(distinct expected_dedupe_key) = 1
) repair
where product.id = repair.product_id;

alter table public.app_products enable trigger set_app_product_normalized_fields;

update public.app_product_occurrences occurrence
set source_dedupe_key = repair.expected_dedupe_key,
    updated_at = clock_timestamp()
from product_identity_repairs repair
join public.app_products product
  on product.id = repair.product_id
 and product.dedupe_key = repair.expected_dedupe_key
where occurrence.id = repair.occurrence_id;

revoke execute on function public.is_generic_product_description(text, text, text) from public, anon, authenticated;
grant execute on function public.is_generic_product_description(text, text, text) to service_role;
