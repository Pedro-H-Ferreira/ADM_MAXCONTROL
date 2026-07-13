-- Refine only inferred Fluig classifications. Manual decisions remain authoritative.
with normalized as (
  select
    product.id,
    public.normalize_product_catalog_text(product.name) as normalized_name,
    public.normalize_product_catalog_text(
      concat_ws(' ', product.name, product.specification)
    ) as normalized_description,
    public.normalize_product_catalog_text(product.category_label) as normalized_category,
    public.is_generic_product_description(
      product.name,
      product.description,
      product.specification
    ) as generic_description
  from public.app_products product
  where product.source_system = 'FLUIG'
    and product.status = 'REVIEW'
    and product.classification_source <> 'MANUAL'
    and product.deleted_at is null
), scored as (
  select
    normalized.*,
    (
      normalized.normalized_description ~ '\m(SERVICO|MAO DE OBRA|INSTALACAO|LOCACAO|ALUGUEL|REPARO|CONSERTO|FRETE|LAUDO|CONSULTORIA|HIGIENIZACAO|ADEQUACAO|PINTURA|RECARGA|CALIBRACAO|DEDETIZACAO|ASSESSORIA|TRANSPORTE|TROCA)\M'
      or normalized.normalized_name ~ '^(MANUTENCAO|MANUTENCAO CORRETIVA|MANUTENCAO PREVENTIVA)$'
      or normalized.normalized_name ~ '\mMANUTENCAO (CORRETIVA|PREVENTIVA|DE|EM)\M'
      or normalized.normalized_category ~ '\m(SERVICO|SERVICOS|LOCACAO|ALUGUEL|FRETE|HONORARIO|HONORARIOS|CONSULTORIA)\M'
    ) as service_signal,
    (
      normalized.normalized_description ~ '\m(MATERIAL|PECA|PECAS|FILTRO|OLEO|EPI|EQUIPAMENTO|INSUMO|BOBINA|FITA|FILME|CHAVE|CABO|PARAFUSO|EMBALAGEM|UTENSILIO|IMOBILIZADO|MOVEIS|UNIFORME|UNIFORMES|BANDEJA|LACRE|PAPEL)\M'
      or normalized.normalized_category ~ '\m(MATERIAL|MATERIAIS|EQUIPAMENTO|EQUIPAMENTOS|EPI|INSUMO|INSUMOS|IMOBILIZADO|MOVEIS|UTENSILIOS|UNIFORME|UNIFORMES|BENS DE PEQUENO VALOR|BOBINA|FILME|BANDEJA|EMBALAGEM|LACRE|CARTAZ|SINALIZACAO)\M'
    ) as material_signal
  from normalized
), classified as (
  select
    scored.id,
    case
      when scored.generic_description then 'INDEFINIDO'
      when scored.service_signal and scored.material_signal then 'MISTO'
      when scored.service_signal then 'SERVICO'
      else 'MATERIAL'
    end as item_type,
    case
      when scored.generic_description then 0.00
      when scored.service_signal and scored.material_signal then 0.70
      when scored.service_signal then 0.75
      when scored.material_signal then 0.70
      else 0.55
    end as confidence,
    case
      when scored.generic_description then 'GENERIC_DESCRIPTION'
      when scored.service_signal or scored.material_signal then 'DESCRIPTION_CATEGORY_RULE'
      else 'PURCHASE_CATALOG_DEFAULT'
    end as classification_source
  from scored
)
update public.app_products product
set item_type = classified.item_type,
    classification = classified.item_type,
    classification_confidence = classified.confidence,
    classification_source = classified.classification_source,
    review_required = true,
    updated_at = clock_timestamp()
from classified
where classified.id = product.id;
