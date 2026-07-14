-- Register the products supplied in the Fluig order-observation example.
-- Future historical syncs reuse the same FLUIG dedupe key and attach real occurrences.
insert into public.app_product_categories (
  source_system,
  code,
  label,
  normalized_label,
  active,
  metadata
) values (
  'FLUIG',
  '5150101',
  '5150101 - MATERIAL DE ESCRITORIO - CONS INTERNO',
  public.normalize_product_catalog_text('5150101 - MATERIAL DE ESCRITORIO - CONS INTERNO'),
  true,
  '{"sourceField":"observacaoPedido"}'::jsonb
)
on conflict (source_system, code) do nothing;

insert into public.app_product_material_types (
  code,
  label,
  normalized_label,
  active,
  metadata
) values (
  'ESCRITORIO_SINALIZACAO',
  'Escritorio e sinalizacao',
  public.normalize_product_catalog_text('Escritorio e sinalizacao'),
  true,
  '{"sourceField":"observacaoPedido"}'::jsonb
)
on conflict (normalized_label) do nothing;

with observation_seed(name, specification, unit, sample_quantity, raw_line) as (
  values
    ('PASTA EML A4', 'PCT COM 10', 'PCT', 2::numeric, '* 2 PASTA EML A4 (PCT COM 10)'),
    ('TESOURA BRW 21CM CABO EMBORRACHADO', null, 'UN', null::numeric, '* TESOURA BRW 21CM CABO EMBORRACHADO'),
    ('ARQUIVO FACIL ECONOMICO - AZUL', null, 'CX', 20::numeric, '* 20 CXS ARQUIVO FACIL ECONOMICO - AZUL'),
    ('CHAVEIROS PLASTICO COLORIDO', null, 'PCT', 1::numeric, '* 1 PCT DE CHAVEIROS PLASTICO COLORIDO'),
    ('ESTILETE GRANDE PARA LAMINA DE 18MM', '3 CAIXAS DE 24 UNIDADES CADA', 'CX', 3::numeric, '* 3 CAIXAS DE ESTILETE GRANDE PARA LAMINA DE 18MM (3 CAIXAS DE 24 UNIDADES CADA)'),
    ('COLA INSTANTANEA 20G 793 TEKBOND MEDIA', null, 'UN', 2::numeric, '* 2 COLA INSTANTANEA 20G 793 TEKBOND MEDIA'),
    ('POSTIT AMARELO', null, 'UN', 5::numeric, '* 5 POSTIT AMARELO'),
    ('CLIPS N1', null, 'CX', 5::numeric, '* 5 CXS DE CLIPS N1'),
    ('CALCULADORAS DE BOLSO COM CORDAO', null, 'UN', 10::numeric, '* 10 CALCULADORAS DE BOLSO COM CORDAO')
), normalized_seed as (
  select
    seed.*,
    public.normalize_product_catalog_text(seed.name) as normalized_name,
    public.normalize_product_catalog_text(seed.specification) as normalized_specification
  from observation_seed seed
), keyed_seed as (
  select
    seed.*,
    encode(
      extensions.digest(
        convert_to('v1', 'UTF8')
        || decode('00', 'hex')
        || convert_to(coalesce(seed.normalized_name, ''), 'UTF8')
        || decode('00', 'hex')
        || convert_to(coalesce(seed.normalized_specification, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as dedupe_key
  from normalized_seed seed
)
insert into public.app_products (
  sku,
  name,
  normalized_name,
  dedupe_key,
  description,
  normalized_description,
  specification,
  normalized_specification,
  item_type,
  classification,
  classification_source,
  category,
  category_code,
  category_label,
  material_type,
  unit,
  normalized_unit,
  status,
  source_system,
  sync_status,
  classification_confidence,
  review_required,
  metadata
)
select
  'FLG-' || upper(substr(seed.dedupe_key, 1, 12)),
  seed.name,
  seed.normalized_name,
  seed.dedupe_key,
  seed.name,
  seed.normalized_name,
  seed.specification,
  seed.normalized_specification,
  'MATERIAL',
  'MATERIAL',
  'ORDER_OBSERVATION_SCREENSHOT',
  category.id,
  category.code,
  category.label,
  material_type.id,
  seed.unit,
  public.normalize_product_catalog_text(seed.unit),
  'REVIEW',
  'FLUIG',
  'PENDING',
  0.9000,
  true,
  jsonb_build_object(
    'sourceField', 'observacaoPedido',
    'sourceKind', 'USER_SCREENSHOT_EXAMPLE',
    'sampleQuantity', seed.sample_quantity,
    'rawLine', seed.raw_line,
    'parserVersion', 'order-observation-v1'
  )
from keyed_seed seed
join public.app_product_categories category
  on category.source_system = 'FLUIG'
 and category.code = '5150101'
 and category.deleted_at is null
join public.app_product_material_types material_type
  on material_type.normalized_label = public.normalize_product_catalog_text('Escritorio e sinalizacao')
 and material_type.deleted_at is null
on conflict (source_system, dedupe_key) do nothing;
