create or replace function public.normalize_product_catalog_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        upper(
          translate(
            coalesce(p_value, ''),
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
            'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
          )
        ),
        '[^A-Z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

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
  select
    public.normalize_product_catalog_text(p_name) in (
      'DESCRICAO ACIMA', 'NA DESCRICAO', 'EM ANEXO', 'PEDIDO EM ANEXO', 'TESTE'
    )
    or public.normalize_product_catalog_text(p_description) in (
      'DESCRICAO ACIMA', 'NA DESCRICAO', 'EM ANEXO', 'PEDIDO EM ANEXO', 'TESTE'
    )
    or public.normalize_product_catalog_text(p_specification) in (
      'DESCRICAO ACIMA', 'NA DESCRICAO', 'EM ANEXO', 'PEDIDO EM ANEXO', 'TESTE'
    )
    or (
      public.normalize_product_catalog_text(p_name) in ('EPI', 'MANUTENCAO')
      and public.normalize_product_catalog_text(p_specification) is null
    );
$$;

-- Re-declare with unaccent so fresh databases do not inherit encoding-dependent normalization.
create or replace function public.normalize_product_catalog_text(p_value text)
returns text
language sql
stable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        upper(public.unaccent(coalesce(p_value, ''))),
        '[^A-Z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

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
  select coalesce((
    public.normalize_product_catalog_text(p_name) in (
      'DESCRICAO ACIMA', 'NA DESCRICAO', 'EM ANEXO', 'PEDIDO EM ANEXO', 'TESTE'
    )
    or public.normalize_product_catalog_text(p_description) in (
      'DESCRICAO ACIMA', 'NA DESCRICAO', 'EM ANEXO', 'PEDIDO EM ANEXO', 'TESTE'
    )
    or public.normalize_product_catalog_text(p_specification) in (
      'DESCRICAO ACIMA', 'NA DESCRICAO', 'EM ANEXO', 'PEDIDO EM ANEXO', 'TESTE'
    )
    or (
      public.normalize_product_catalog_text(p_name) in ('EPI', 'MANUTENCAO')
      and public.normalize_product_catalog_text(p_specification) is null
    )
  ), false);
$$;

create table public.app_product_categories (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'FLUIG',
  code text not null,
  label text not null,
  normalized_label text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_product_categories_source_system_check check (source_system ~ '^[A-Z][A-Z0-9_]*$'),
  constraint app_product_categories_code_check check (btrim(code) <> ''),
  constraint app_product_categories_label_check check (btrim(label) <> ''),
  constraint app_product_categories_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint app_product_categories_source_code_unique unique (source_system, code)
);

create index app_product_categories_normalized_label_idx
  on public.app_product_categories (normalized_label);

create table public.app_product_material_types (
  id uuid primary key default gen_random_uuid(),
  code text,
  label text not null,
  normalized_label text not null unique,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_product_material_types_code_check check (
    code is null or code ~ '^[A-Z][A-Z0-9_]*$'
  ),
  constraint app_product_material_types_label_check check (btrim(label) <> ''),
  constraint app_product_material_types_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index app_product_material_types_code_unique_idx
  on public.app_product_material_types (code)
  where code is not null;

create table public.app_products (
  id uuid primary key default gen_random_uuid(),
  sku text,
  name text not null,
  normalized_name text not null,
  dedupe_key text not null,
  description text,
  normalized_description text,
  specification text,
  normalized_specification text,
  item_type text not null,
  classification text not null default 'INDEFINIDO',
  classification_source text not null default 'MANUAL',
  category uuid references public.app_product_categories(id) on delete restrict,
  category_code text,
  category_label text,
  material_type uuid references public.app_product_material_types(id) on delete restrict,
  unit text,
  normalized_unit text,
  status text not null default 'REVIEW',
  source_system text not null default 'FLUIG',
  sync_status text not null default 'PENDING',
  sync_error text,
  classification_confidence numeric(5, 4) not null default 0,
  review_required boolean not null default true,
  image_path text,
  product_image_path text generated always as (image_path) stored,
  image_url text,
  product_url text,
  first_fluig_request_id uuid references public.fluig_requests(id) on delete restrict,
  last_fluig_request_id uuid references public.fluig_requests(id) on delete restrict,
  occurrence_count bigint not null default 0,
  last_unit_price_cents bigint,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_products_name_check check (btrim(name) <> ''),
  constraint app_products_normalized_name_check check (btrim(normalized_name) <> ''),
  constraint app_products_dedupe_key_check check (btrim(dedupe_key) <> ''),
  constraint app_products_item_type_check check (item_type in ('MATERIAL', 'SERVICO', 'MISTO', 'INDEFINIDO')),
  constraint app_products_classification_check check (
    classification in ('MATERIAL', 'SERVICO', 'MISTO', 'INDEFINIDO')
    and classification = item_type
  ),
  constraint app_products_classification_source_check check (btrim(classification_source) <> ''),
  constraint app_products_status_check check (status in ('ACTIVE', 'REVIEW', 'INACTIVE')),
  constraint app_products_sync_status_check check (sync_status in ('PENDING', 'SYNCED', 'STALE', 'ERROR')),
  constraint app_products_source_system_check check (source_system ~ '^[A-Z][A-Z0-9_]*$'),
  constraint app_products_classification_confidence_check check (
    classification_confidence >= 0 and classification_confidence <= 1
  ),
  constraint app_products_occurrence_count_check check (occurrence_count >= 0),
  constraint app_products_last_unit_price_check check (
    last_unit_price_cents is null or last_unit_price_cents >= 0
  ),
  constraint app_products_image_path_check check (
    image_path is null
    or (
      btrim(image_path) <> ''
      and image_path !~ '(^/|(^|/)\.\.(/|$)|://)'
    )
  ),
  constraint app_products_image_url_check check (
    image_url is null or image_url ~* '^https?://'
  ),
  constraint app_products_product_url_check check (
    product_url is null or product_url ~* '^https?://'
  ),
  constraint app_products_seen_range_check check (
    first_seen_at is null or last_seen_at is null or first_seen_at <= last_seen_at
  ),
  constraint app_products_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint app_products_source_dedupe_unique unique (source_system, dedupe_key)
);

comment on column public.app_products.category is
  'FK editavel para a categoria financeira de contaCentroCusto/codContaFin.';
comment on column public.app_products.category_code is
  'Snapshot do formFields.contaCentroCusto usado na classificacao financeira.';
comment on column public.app_products.category_label is
  'Snapshot do formFields.codContaFin usado na classificacao financeira.';
comment on column public.app_products.material_type is
  'FK editavel para app_product_material_types; o label deve ser exposto por join.';
comment on column public.app_products.dedupe_key is
  'Identidade estavel da origem. Nao deve ser derivada somente do nome normalizado.';
comment on column public.app_products.product_image_path is
  'Alias gerado de image_path para compatibilidade do contrato de fotos.';

create table public.app_product_occurrences (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.app_products(id) on delete restrict,
  fluig_request_id uuid not null references public.fluig_requests(id) on delete restrict,
  source_table text not null,
  source_row_index integer not null,
  source_dedupe_key text not null,
  source_sku text,
  source_name text not null,
  source_description text,
  source_specification text,
  source_category_code text,
  source_category_label text,
  source_material_type_label text,
  source_unit text,
  branch_id uuid references public.app_branches(id) on delete restrict,
  branch_code text,
  branch_label text,
  quantity numeric(20, 6),
  unit_price_cents bigint,
  total_price_cents bigint,
  currency_code text not null default 'BRL',
  price_effective_at timestamptz,
  observed_at timestamptz not null,
  source_payload jsonb not null default '{}'::jsonb,
  source_payload_hash text not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_product_occurrences_source_table_check check (btrim(source_table) <> ''),
  constraint app_product_occurrences_source_row_index_check check (source_row_index >= 0),
  constraint app_product_occurrences_source_dedupe_key_check check (btrim(source_dedupe_key) <> ''),
  constraint app_product_occurrences_source_name_check check (btrim(source_name) <> ''),
  constraint app_product_occurrences_quantity_check check (quantity is null or quantity >= 0),
  constraint app_product_occurrences_unit_price_check check (
    unit_price_cents is null or unit_price_cents >= 0
  ),
  constraint app_product_occurrences_total_price_check check (
    total_price_cents is null or total_price_cents >= 0
  ),
  constraint app_product_occurrences_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint app_product_occurrences_payload_check check (jsonb_typeof(source_payload) = 'object'),
  constraint app_product_occurrences_payload_hash_check check (source_payload_hash ~ '^[a-f0-9]{32}$'),
  constraint app_product_occurrences_request_row_unique unique (
    fluig_request_id,
    source_table,
    source_row_index
  )
);

create table public.app_product_branch_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.app_products(id) on delete restrict,
  branch_id uuid not null references public.app_branches(id) on delete restrict,
  link_source text not null,
  first_occurrence_id uuid references public.app_product_occurrences(id) on delete restrict,
  last_occurrence_id uuid references public.app_product_occurrences(id) on delete restrict,
  occurrence_count bigint not null default 0,
  active boolean not null default true,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_product_branch_links_source_check check (link_source in ('FLUIG', 'MANUAL')),
  constraint app_product_branch_links_occurrence_count_check check (occurrence_count >= 0),
  constraint app_product_branch_links_product_branch_source_unique unique (
    product_id,
    branch_id,
    link_source
  )
);

create table public.app_product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.app_products(id) on delete restrict,
  occurrence_id uuid not null references public.app_product_occurrences(id) on delete restrict,
  fluig_request_id uuid not null references public.fluig_requests(id) on delete restrict,
  quantity numeric(20, 6),
  unit_price_cents bigint not null,
  total_price_cents bigint,
  currency_code text not null default 'BRL',
  effective_at timestamptz not null,
  observed_at timestamptz not null,
  source_system text not null default 'FLUIG',
  price_fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint app_product_price_history_quantity_check check (quantity is null or quantity >= 0),
  constraint app_product_price_history_unit_price_check check (unit_price_cents >= 0),
  constraint app_product_price_history_total_price_check check (
    total_price_cents is null or total_price_cents >= 0
  ),
  constraint app_product_price_history_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint app_product_price_history_source_system_check check (source_system ~ '^[A-Z][A-Z0-9_]*$'),
  constraint app_product_price_history_fingerprint_check check (price_fingerprint ~ '^[a-f0-9]{32}$'),
  constraint app_product_price_history_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint app_product_price_history_occurrence_price_unique unique (occurrence_id, price_fingerprint)
);

create table public.app_product_audit_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.app_products(id) on delete restrict,
  occurrence_id uuid references public.app_product_occurrences(id) on delete restrict,
  fluig_request_id uuid references public.fluig_requests(id) on delete restrict,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null,
  idempotency_key text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint app_product_audit_events_type_check check (event_type ~ '^[A-Z][A-Z0-9_]*$'),
  constraint app_product_audit_events_idempotency_check check (btrim(idempotency_key) <> ''),
  constraint app_product_audit_events_before_check check (jsonb_typeof(before_data) = 'object'),
  constraint app_product_audit_events_after_check check (jsonb_typeof(after_data) = 'object'),
  constraint app_product_audit_events_data_check check (jsonb_typeof(event_data) = 'object'),
  constraint app_product_audit_events_product_idempotency_unique unique (product_id, idempotency_key)
);

create index app_products_normalized_name_idx
  on public.app_products (normalized_name, item_type)
  where deleted_at is null;
create index app_products_category_status_idx
  on public.app_products (category, status)
  where deleted_at is null;
create index app_products_material_type_status_idx
  on public.app_products (material_type, status)
  where deleted_at is null;
create index app_products_sync_status_idx
  on public.app_products (sync_status, last_synced_at desc);
create index app_products_last_fluig_request_idx
  on public.app_products (last_fluig_request_id);
create index app_products_first_fluig_request_idx
  on public.app_products (first_fluig_request_id);
create index app_products_created_by_user_idx
  on public.app_products (created_by_user_id);
create index app_products_updated_by_user_idx
  on public.app_products (updated_by_user_id);
create unique index app_products_source_sku_unique_idx
  on public.app_products (source_system, upper(sku))
  where sku is not null and deleted_at is null;

create index app_product_occurrences_product_observed_idx
  on public.app_product_occurrences (product_id, observed_at desc);
create index app_product_occurrences_request_idx
  on public.app_product_occurrences (fluig_request_id);
create index app_product_occurrences_branch_idx
  on public.app_product_occurrences (branch_id, observed_at desc);
create index app_product_occurrences_branch_code_idx
  on public.app_product_occurrences (branch_code, observed_at desc);
create index app_product_occurrences_product_branch_idx
  on public.app_product_occurrences (product_id, branch_id, observed_at desc);
create index app_product_occurrences_product_branch_code_idx
  on public.app_product_occurrences (product_id, branch_code, observed_at desc);

create index app_product_branch_links_branch_product_idx
  on public.app_product_branch_links (branch_id, product_id)
  where active;
create index app_product_branch_links_product_idx
  on public.app_product_branch_links (product_id, branch_id, link_source);
create index app_product_branch_links_first_occurrence_idx
  on public.app_product_branch_links (first_occurrence_id);
create index app_product_branch_links_last_occurrence_idx
  on public.app_product_branch_links (last_occurrence_id);
create index app_product_branch_links_created_by_user_idx
  on public.app_product_branch_links (created_by_user_id);
create index app_product_branch_links_updated_by_user_idx
  on public.app_product_branch_links (updated_by_user_id);

create index app_product_price_history_product_effective_idx
  on public.app_product_price_history (product_id, effective_at desc, created_at desc);
create index app_product_price_history_request_idx
  on public.app_product_price_history (fluig_request_id);
create index app_product_price_history_occurrence_idx
  on public.app_product_price_history (occurrence_id);
create index app_product_price_history_created_by_user_idx
  on public.app_product_price_history (created_by_user_id);

create index app_product_audit_events_product_created_idx
  on public.app_product_audit_events (product_id, created_at desc);
create index app_product_audit_events_occurrence_idx
  on public.app_product_audit_events (occurrence_id);
create index app_product_audit_events_request_idx
  on public.app_product_audit_events (fluig_request_id);
create index app_product_audit_events_actor_created_idx
  on public.app_product_audit_events (actor_user_id, created_at desc)
  where actor_user_id is not null;

create or replace function public.set_product_reference_normalized_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.label := nullif(regexp_replace(btrim(new.label), '[[:space:]]+', ' ', 'g'), '');
  new.normalized_label := public.normalize_product_catalog_text(new.label);
  new.code := nullif(btrim(new.code), '');
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger set_app_product_categories_normalized_fields
  before insert or update on public.app_product_categories
  for each row execute function public.set_product_reference_normalized_fields();

create or replace function public.set_app_product_category_source_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.source_system := upper(btrim(new.source_system));
  return new;
end;
$$;

create trigger set_app_product_category_source_fields
  before insert or update on public.app_product_categories
  for each row execute function public.set_app_product_category_source_fields();

create trigger set_app_product_material_types_normalized_fields
  before insert or update on public.app_product_material_types
  for each row execute function public.set_product_reference_normalized_fields();

create or replace function public.set_app_product_normalized_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    old.source_system is distinct from new.source_system
    or old.dedupe_key is distinct from new.dedupe_key
  ) then
    raise exception 'PRODUCT_IDENTITY_IMMUTABLE: source_system e dedupe_key nao podem ser alterados.';
  end if;

  new.sku := nullif(btrim(new.sku), '');
  new.name := nullif(regexp_replace(btrim(new.name), '[[:space:]]+', ' ', 'g'), '');
  new.normalized_name := public.normalize_product_catalog_text(new.name);
  new.description := nullif(regexp_replace(btrim(new.description), '[[:space:]]+', ' ', 'g'), '');
  new.normalized_description := public.normalize_product_catalog_text(new.description);
  new.specification := nullif(regexp_replace(btrim(new.specification), '[[:space:]]+', ' ', 'g'), '');
  new.normalized_specification := public.normalize_product_catalog_text(new.specification);
  new.unit := nullif(regexp_replace(btrim(new.unit), '[[:space:]]+', ' ', 'g'), '');
  new.normalized_unit := public.normalize_product_catalog_text(new.unit);
  new.item_type := upper(btrim(new.item_type));
  new.classification := new.item_type;
  new.classification_source := upper(btrim(new.classification_source));
  new.category_code := nullif(btrim(new.category_code), '');
  new.category_label := nullif(regexp_replace(btrim(new.category_label), '[[:space:]]+', ' ', 'g'), '');
  new.source_system := upper(btrim(new.source_system));
  new.sync_status := upper(btrim(new.sync_status));
  new.status := upper(btrim(new.status));
  new.dedupe_key := btrim(new.dedupe_key);
  new.image_path := nullif(btrim(new.image_path), '');
  new.image_url := nullif(btrim(new.image_url), '');
  new.product_url := nullif(btrim(new.product_url), '');
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger set_app_product_normalized_fields
  before insert or update on public.app_products
  for each row execute function public.set_app_product_normalized_fields();

create or replace function public.set_app_product_occurrence_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    old.product_id is distinct from new.product_id
    or old.fluig_request_id is distinct from new.fluig_request_id
    or old.source_table is distinct from new.source_table
    or old.source_row_index is distinct from new.source_row_index
  ) then
    raise exception 'PRODUCT_OCCURRENCE_IDENTITY_IMMUTABLE: a origem da ocorrencia nao pode ser alterada.';
  end if;

  new.source_table := btrim(new.source_table);
  new.source_dedupe_key := btrim(new.source_dedupe_key);
  new.source_sku := nullif(btrim(new.source_sku), '');
  new.source_name := nullif(regexp_replace(btrim(new.source_name), '[[:space:]]+', ' ', 'g'), '');
  new.source_description := nullif(regexp_replace(btrim(new.source_description), '[[:space:]]+', ' ', 'g'), '');
  new.source_specification := nullif(regexp_replace(btrim(new.source_specification), '[[:space:]]+', ' ', 'g'), '');
  new.source_category_code := nullif(btrim(new.source_category_code), '');
  new.source_category_label := nullif(regexp_replace(btrim(new.source_category_label), '[[:space:]]+', ' ', 'g'), '');
  new.source_material_type_label := nullif(regexp_replace(btrim(new.source_material_type_label), '[[:space:]]+', ' ', 'g'), '');
  new.source_unit := nullif(regexp_replace(btrim(new.source_unit), '[[:space:]]+', ' ', 'g'), '');
  new.branch_code := nullif(btrim(new.branch_code), '');
  new.branch_label := nullif(regexp_replace(btrim(new.branch_label), '[[:space:]]+', ' ', 'g'), '');
  new.currency_code := upper(btrim(new.currency_code));
  new.source_payload := coalesce(new.source_payload, '{}'::jsonb);
  new.source_payload_hash := md5(new.source_payload::text);
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger set_app_product_occurrence_fields
  before insert or update on public.app_product_occurrences
  for each row execute function public.set_app_product_occurrence_fields();

create or replace function public.set_app_product_branch_link_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    old.product_id is distinct from new.product_id
    or old.branch_id is distinct from new.branch_id
    or old.link_source is distinct from new.link_source
  ) then
    raise exception 'PRODUCT_BRANCH_LINK_IDENTITY_IMMUTABLE: produto, filial e origem nao podem ser alterados.';
  end if;

  new.link_source := upper(btrim(new.link_source));
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger set_app_product_branch_link_fields
  before insert or update on public.app_product_branch_links
  for each row execute function public.set_app_product_branch_link_fields();

create or replace function public.upsert_fluig_product_history(
  p_module_slug text,
  p_fluig_request_number text,
  p_source_table text,
  p_source_row_index integer,
  p_dedupe_key text,
  p_name text,
  p_item_type text,
  p_sku text default null,
  p_description text default null,
  p_specification text default null,
  p_category_code text default null,
  p_category_label text default null,
  p_material_type_label text default null,
  p_unit text default null,
  p_quantity numeric default null,
  p_unit_price_cents bigint default null,
  p_total_price_cents bigint default null,
  p_currency_code text default 'BRL',
  p_price_effective_at timestamptz default null,
  p_status text default 'REVIEW',
  p_sync_status text default 'SYNCED',
  p_classification_confidence numeric default 0,
  p_classification_source text default 'FLUIG_RULES',
  p_review_required boolean default true,
  p_image_path text default null,
  p_image_url text default null,
  p_product_url text default null,
  p_source_payload jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.fluig_requests%rowtype;
  v_product public.app_products%rowtype;
  v_occurrence public.app_product_occurrences%rowtype;
  v_category_id uuid;
  v_material_type_id uuid;
  v_branch_id uuid;
  v_request_seen_at timestamptz;
  v_effective_at timestamptz;
  v_item_type text := upper(btrim(coalesce(p_item_type, '')));
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_sync_status text := upper(btrim(coalesce(p_sync_status, '')));
  v_currency_code text := upper(btrim(coalesce(p_currency_code, 'BRL')));
  v_dedupe_key text := btrim(coalesce(p_dedupe_key, ''));
  v_category_code text := nullif(btrim(p_category_code), '');
  v_category_label text := nullif(regexp_replace(btrim(p_category_label), '[[:space:]]+', ' ', 'g'), '');
  v_normalized_material_type text;
  v_classification_source text := upper(btrim(coalesce(p_classification_source, 'FLUIG_RULES')));
  v_classification_confidence numeric := coalesce(p_classification_confidence, 0);
  v_review_required boolean := coalesce(p_review_required, true);
  v_generic_description boolean := coalesce(
    public.is_generic_product_description(p_name, p_description, p_specification),
    false
  );
  v_product_created boolean := false;
  v_classification_fallback boolean := false;
  v_before_data jsonb := '{}'::jsonb;
  v_after_data jsonb;
  v_occurrence_count bigint;
  v_first_request_id uuid;
  v_last_request_id uuid;
  v_first_seen_at timestamptz;
  v_last_seen_at timestamptz;
  v_last_unit_price_cents bigint;
  v_branch_occurrence_count bigint;
  v_first_branch_occurrence_id uuid;
  v_last_branch_occurrence_id uuid;
  v_price_fingerprint text;
  v_audit_key text;
begin
  if nullif(btrim(coalesce(p_module_slug, '')), '') is null
     or nullif(btrim(coalesce(p_fluig_request_number, '')), '') is null then
    raise exception 'FLUIG_REQUEST_REQUIRED: modulo e numero da solicitacao sao obrigatorios.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_source_table, '')), '') is null or p_source_row_index is null or p_source_row_index < 0 then
    raise exception 'PRODUCT_SOURCE_ROW_INVALID: source_table e source_row_index nao negativo sao obrigatorios.' using errcode = '22023';
  end if;

  if not v_generic_description and v_dedupe_key = '' then
    raise exception 'PRODUCT_DEDUPE_KEY_REQUIRED: informe uma identidade estavel da origem, nunca apenas o nome.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'PRODUCT_NAME_REQUIRED: nome do produto ou servico e obrigatorio.' using errcode = '22023';
  end if;

  if v_generic_description then
    v_item_type := 'INDEFINIDO';
    v_status := 'REVIEW';
    v_classification_source := 'GENERIC_DESCRIPTION';
    v_classification_confidence := 0;
    v_review_required := true;
  elsif v_item_type not in ('MATERIAL', 'SERVICO', 'MISTO', 'INDEFINIDO') then
    raise exception 'PRODUCT_ITEM_TYPE_INVALID: use MATERIAL, SERVICO, MISTO ou INDEFINIDO.' using errcode = '22023';
  end if;

  if v_status not in ('ACTIVE', 'REVIEW', 'INACTIVE') then
    raise exception 'PRODUCT_STATUS_INVALID: use ACTIVE, REVIEW ou INACTIVE.' using errcode = '22023';
  end if;

  if v_sync_status not in ('PENDING', 'SYNCED', 'STALE', 'ERROR') then
    raise exception 'PRODUCT_SYNC_STATUS_INVALID: use PENDING, SYNCED, STALE ou ERROR.' using errcode = '22023';
  end if;

  if v_classification_confidence < 0 or v_classification_confidence > 1 then
    raise exception 'PRODUCT_CLASSIFICATION_CONFIDENCE_INVALID: use valor entre 0 e 1.' using errcode = '22023';
  end if;

  if v_classification_source = '' then
    raise exception 'PRODUCT_CLASSIFICATION_SOURCE_REQUIRED: informe a origem da classificacao.' using errcode = '22023';
  end if;

  if p_quantity is not null and p_quantity < 0 then
    raise exception 'PRODUCT_QUANTITY_INVALID: quantidade nao pode ser negativa.' using errcode = '22023';
  end if;

  if p_unit_price_cents is not null and p_unit_price_cents < 0 then
    raise exception 'PRODUCT_UNIT_PRICE_INVALID: preco unitario nao pode ser negativo.' using errcode = '22023';
  end if;

  if p_total_price_cents is not null and p_total_price_cents < 0 then
    raise exception 'PRODUCT_TOTAL_PRICE_INVALID: preco total nao pode ser negativo.' using errcode = '22023';
  end if;

  if v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'PRODUCT_CURRENCY_INVALID: use codigo ISO de tres letras.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_source_payload, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'PRODUCT_JSON_INVALID: source_payload e metadata devem ser objetos JSON.' using errcode = '22023';
  end if;

  select request.*
  into v_request
  from public.fluig_requests request
  where request.module_slug = btrim(p_module_slug)
    and request.fluig_request_id = btrim(p_fluig_request_number);

  if not found then
    raise exception 'FLUIG_REQUEST_NOT_FOUND: solicitacao %/% nao encontrada.', p_module_slug, p_fluig_request_number
      using errcode = 'P0002';
  end if;

  v_request_seen_at := coalesce(v_request.opened_at, v_request.last_synced_at, v_request.created_at, clock_timestamp());
  v_effective_at := coalesce(p_price_effective_at, v_request_seen_at);
  v_normalized_material_type := public.normalize_product_catalog_text(p_material_type_label);

  if v_generic_description then
    v_dedupe_key := concat(
      'OCCURRENCE:',
      v_request.id::text,
      ':',
      btrim(p_source_table),
      ':',
      p_source_row_index::text
    );
  end if;

  v_branch_id := v_request.branch_id;
  if v_branch_id is null and nullif(btrim(v_request.branch_code), '') is not null then
    select branch.id
    into v_branch_id
    from public.app_branches branch
    where branch.code = btrim(v_request.branch_code)
    limit 1;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws(':', 'app_products', 'FLUIG', v_dedupe_key), 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws(':', 'app_product_occurrences', v_request.id::text, btrim(p_source_table), p_source_row_index::text), 0)
  );

  if v_category_code is not null and v_category_label is not null then
    insert into public.app_product_categories (
      source_system,
      code,
      label,
      normalized_label,
      metadata
    ) values (
      'FLUIG',
      v_category_code,
      v_category_label,
      public.normalize_product_catalog_text(v_category_label),
      jsonb_build_object(
        'codeField', 'contaCentroCusto',
        'labelField', 'codContaFin'
      )
    )
    on conflict (source_system, code) do update
    set label = excluded.label,
        normalized_label = excluded.normalized_label,
        active = true,
        deleted_at = null,
        updated_at = clock_timestamp()
    returning id into v_category_id;
  elsif v_category_code is not null or v_category_label is not null then
    v_classification_fallback := true;
  end if;

  if v_normalized_material_type is not null then
    insert into public.app_product_material_types (label, normalized_label, metadata)
    values (
      nullif(regexp_replace(btrim(p_material_type_label), '[[:space:]]+', ' ', 'g'), ''),
      v_normalized_material_type,
      jsonb_build_object('sourceSystem', 'FLUIG')
    )
    on conflict (normalized_label) do update
    set updated_at = clock_timestamp()
    returning id into v_material_type_id;
  end if;

  select occurrence.*
  into v_occurrence
  from public.app_product_occurrences occurrence
  where occurrence.fluig_request_id = v_request.id
    and occurrence.source_table = btrim(p_source_table)
    and occurrence.source_row_index = p_source_row_index
  for update;

  if found then
    select product.*
    into v_product
    from public.app_products product
    where product.id = v_occurrence.product_id
    for update;

    if v_product.source_system <> 'FLUIG'
       or v_product.dedupe_key <> v_dedupe_key then
      raise exception 'PRODUCT_OCCURRENCE_COLLISION: a linha Fluig ja pertence a outra identidade de produto.'
        using errcode = '23505';
    end if;
  else
    select product.*
    into v_product
    from public.app_products product
    where product.source_system = 'FLUIG'
      and product.dedupe_key = v_dedupe_key
    for update;
  end if;

  if v_product.id is not null and v_product.deleted_at is not null then
    raise exception 'PRODUCT_DELETED_REQUIRES_REVIEW: a identidade aponta para produto excluido.' using errcode = '23514';
  end if;

  if v_product.id is null then
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
      image_path,
      image_url,
      product_url,
      first_fluig_request_id,
      last_fluig_request_id,
      first_seen_at,
      last_seen_at,
      last_synced_at,
      metadata,
      created_by_user_id,
      updated_by_user_id
    ) values (
      nullif(btrim(p_sku), ''),
      p_name,
      public.normalize_product_catalog_text(p_name),
      v_dedupe_key,
      p_description,
      public.normalize_product_catalog_text(p_description),
      p_specification,
      public.normalize_product_catalog_text(p_specification),
      v_item_type,
      v_item_type,
      v_classification_source,
      v_category_id,
      v_category_code,
      v_category_label,
      v_material_type_id,
      p_unit,
      public.normalize_product_catalog_text(p_unit),
      v_status,
      'FLUIG',
      v_sync_status,
      v_classification_confidence,
      v_review_required or v_classification_fallback,
      nullif(btrim(p_image_path), ''),
      nullif(btrim(p_image_url), ''),
      nullif(btrim(p_product_url), ''),
      v_request.id,
      v_request.id,
      v_request_seen_at,
      v_request_seen_at,
      clock_timestamp(),
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'lastSourceCategoryCode', v_category_code,
        'lastSourceCategoryLabel', v_category_label,
        'lastSourceMaterialType', nullif(btrim(p_material_type_label), '')
      ),
      p_actor_user_id,
      p_actor_user_id
    )
    returning * into v_product;

    v_product_created := true;
  else
    v_before_data := to_jsonb(v_product);

    update public.app_products product
    set sku = coalesce(nullif(btrim(p_sku), ''), product.sku),
        name = p_name,
        description = p_description,
        specification = p_specification,
        category = case when product.status = 'REVIEW' then coalesce(v_category_id, product.category) else product.category end,
        category_code = case when product.status = 'REVIEW' then coalesce(v_category_code, product.category_code) else product.category_code end,
        category_label = case when product.status = 'REVIEW' then coalesce(v_category_label, product.category_label) else product.category_label end,
        material_type = case when product.status = 'REVIEW' then coalesce(v_material_type_id, product.material_type) else product.material_type end,
        unit = coalesce(nullif(btrim(p_unit), ''), product.unit),
        status = case when product.status = 'REVIEW' then v_status else product.status end,
        classification = product.item_type,
        classification_source = case when product.status = 'REVIEW' then v_classification_source else product.classification_source end,
        sync_status = v_sync_status,
        sync_error = case when v_sync_status = 'ERROR' then product.sync_error else null end,
        classification_confidence = case
          when product.status = 'REVIEW' then greatest(product.classification_confidence, v_classification_confidence)
          else product.classification_confidence
        end,
        review_required = case
          when product.status = 'REVIEW' then product.review_required or v_review_required or v_classification_fallback
          else product.review_required
        end,
        image_path = coalesce(nullif(btrim(p_image_path), ''), product.image_path),
        image_url = coalesce(nullif(btrim(p_image_url), ''), product.image_url),
        product_url = coalesce(nullif(btrim(p_product_url), ''), product.product_url),
        last_synced_at = clock_timestamp(),
        metadata = product.metadata || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
          'lastSourceCategoryCode', v_category_code,
          'lastSourceCategoryLabel', v_category_label,
          'lastSourceMaterialType', nullif(btrim(p_material_type_label), '')
        ),
        updated_by_user_id = coalesce(p_actor_user_id, product.updated_by_user_id)
    where product.id = v_product.id
    returning * into v_product;
  end if;

  if v_occurrence.id is null then
    insert into public.app_product_occurrences (
      product_id,
      fluig_request_id,
      source_table,
      source_row_index,
      source_dedupe_key,
      source_sku,
      source_name,
      source_description,
      source_specification,
      source_category_code,
      source_category_label,
      source_material_type_label,
      source_unit,
      branch_id,
      branch_code,
      branch_label,
      quantity,
      unit_price_cents,
      total_price_cents,
      currency_code,
      price_effective_at,
      observed_at,
      source_payload,
      source_payload_hash
    ) values (
      v_product.id,
      v_request.id,
      btrim(p_source_table),
      p_source_row_index,
      v_dedupe_key,
      nullif(btrim(p_sku), ''),
      p_name,
      p_description,
      p_specification,
      v_category_code,
      v_category_label,
      p_material_type_label,
      p_unit,
      v_branch_id,
      v_request.branch_code,
      v_request.branch_label,
      p_quantity,
      p_unit_price_cents,
      p_total_price_cents,
      v_currency_code,
      case when p_unit_price_cents is null then null else v_effective_at end,
      v_request_seen_at,
      coalesce(p_source_payload, '{}'::jsonb),
      md5(coalesce(p_source_payload, '{}'::jsonb)::text)
    )
    returning * into v_occurrence;
  else
    update public.app_product_occurrences occurrence
    set source_dedupe_key = v_dedupe_key,
        source_sku = nullif(btrim(p_sku), ''),
        source_name = p_name,
        source_description = p_description,
        source_specification = p_specification,
        source_category_code = v_category_code,
        source_category_label = v_category_label,
        source_material_type_label = p_material_type_label,
        source_unit = p_unit,
        branch_id = v_branch_id,
        branch_code = v_request.branch_code,
        branch_label = v_request.branch_label,
        quantity = p_quantity,
        unit_price_cents = p_unit_price_cents,
        total_price_cents = p_total_price_cents,
        currency_code = v_currency_code,
        price_effective_at = case when p_unit_price_cents is null then null else v_effective_at end,
        observed_at = v_request_seen_at,
        source_payload = coalesce(p_source_payload, '{}'::jsonb)
    where occurrence.id = v_occurrence.id
    returning * into v_occurrence;
  end if;

  if p_unit_price_cents is not null then
    v_price_fingerprint := md5(concat_ws(
      ':',
      v_occurrence.id::text,
      p_quantity::text,
      p_unit_price_cents::text,
      p_total_price_cents::text,
      v_currency_code,
      v_effective_at::text
    ));

    insert into public.app_product_price_history (
      product_id,
      occurrence_id,
      fluig_request_id,
      quantity,
      unit_price_cents,
      total_price_cents,
      currency_code,
      effective_at,
      observed_at,
      source_system,
      price_fingerprint,
      metadata,
      created_by_user_id
    ) values (
      v_product.id,
      v_occurrence.id,
      v_request.id,
      p_quantity,
      p_unit_price_cents,
      p_total_price_cents,
      v_currency_code,
      v_effective_at,
      v_request_seen_at,
      'FLUIG',
      v_price_fingerprint,
      jsonb_build_object(
        'moduleSlug', v_request.module_slug,
        'fluigRequestNumber', v_request.fluig_request_id,
        'sourceTable', v_occurrence.source_table,
        'sourceRowIndex', v_occurrence.source_row_index
      ),
      p_actor_user_id
    )
    on conflict (occurrence_id, price_fingerprint) do nothing;
  end if;

  if v_occurrence.branch_id is not null then
    insert into public.app_product_branch_links (
      product_id,
      branch_id,
      link_source,
      first_occurrence_id,
      last_occurrence_id,
      occurrence_count,
      created_by_user_id,
      updated_by_user_id
    ) values (
      v_product.id,
      v_occurrence.branch_id,
      'FLUIG',
      v_occurrence.id,
      v_occurrence.id,
      1,
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (product_id, branch_id, link_source) do nothing;

    select
      count(*)::bigint,
      (array_agg(branch_occurrence.id order by branch_occurrence.observed_at, branch_occurrence.imported_at, branch_occurrence.id))[1],
      (array_agg(branch_occurrence.id order by branch_occurrence.observed_at desc, branch_occurrence.imported_at desc, branch_occurrence.id desc))[1]
    into
      v_branch_occurrence_count,
      v_first_branch_occurrence_id,
      v_last_branch_occurrence_id
    from public.app_product_occurrences branch_occurrence
    where branch_occurrence.product_id = v_product.id
      and branch_occurrence.branch_id = v_occurrence.branch_id;

    update public.app_product_branch_links branch_link
    set first_occurrence_id = v_first_branch_occurrence_id,
        last_occurrence_id = v_last_branch_occurrence_id,
        occurrence_count = v_branch_occurrence_count,
        active = true,
        updated_by_user_id = coalesce(p_actor_user_id, branch_link.updated_by_user_id),
        updated_at = clock_timestamp()
    where branch_link.product_id = v_product.id
      and branch_link.branch_id = v_occurrence.branch_id
      and branch_link.link_source = 'FLUIG';
  end if;

  select
    count(*)::bigint,
    (array_agg(occurrence.fluig_request_id order by occurrence.observed_at, occurrence.imported_at, occurrence.id))[1],
    (array_agg(occurrence.fluig_request_id order by occurrence.observed_at desc, occurrence.imported_at desc, occurrence.id desc))[1],
    min(occurrence.observed_at),
    max(occurrence.observed_at)
  into
    v_occurrence_count,
    v_first_request_id,
    v_last_request_id,
    v_first_seen_at,
    v_last_seen_at
  from public.app_product_occurrences occurrence
  where occurrence.product_id = v_product.id;

  select price.unit_price_cents
  into v_last_unit_price_cents
  from public.app_product_price_history price
  where price.product_id = v_product.id
  order by price.effective_at desc, price.observed_at desc, price.created_at desc, price.id desc
  limit 1;

  update public.app_products product
  set first_fluig_request_id = v_first_request_id,
      last_fluig_request_id = v_last_request_id,
      occurrence_count = v_occurrence_count,
      last_unit_price_cents = v_last_unit_price_cents,
      first_seen_at = v_first_seen_at,
      last_seen_at = v_last_seen_at,
      last_synced_at = clock_timestamp(),
      updated_by_user_id = coalesce(p_actor_user_id, product.updated_by_user_id)
  where product.id = v_product.id
  returning * into v_product;

  v_after_data := to_jsonb(v_product);
  v_audit_key := md5(concat_ws(
    ':',
    'FLUIG_HISTORY_IMPORT',
    v_request.id::text,
    v_occurrence.source_table,
    v_occurrence.source_row_index::text,
    v_dedupe_key,
    public.normalize_product_catalog_text(p_name),
    public.normalize_product_catalog_text(p_description),
    public.normalize_product_catalog_text(p_specification),
    v_occurrence.source_payload_hash,
    p_unit_price_cents::text,
    p_total_price_cents::text
  ));

  insert into public.app_product_audit_events (
    product_id,
    occurrence_id,
    fluig_request_id,
    actor_user_id,
    event_type,
    idempotency_key,
    before_data,
    after_data,
    event_data
  ) values (
    v_product.id,
    v_occurrence.id,
    v_request.id,
    p_actor_user_id,
    'FLUIG_HISTORY_IMPORT',
    v_audit_key,
    v_before_data,
    v_after_data,
    jsonb_build_object(
      'moduleSlug', v_request.module_slug,
      'fluigRequestNumber', v_request.fluig_request_id,
      'sourceTable', v_occurrence.source_table,
      'sourceRowIndex', v_occurrence.source_row_index,
      'productCreated', v_product_created,
      'classificationFallback', v_classification_fallback,
      'genericDescriptionGuard', v_generic_description,
      'classification', v_product.classification,
      'classificationSource', v_product.classification_source,
      'categoryCode', v_product.category_code,
      'categoryLabel', v_product.category_label
    )
  )
  on conflict (product_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'productId', v_product.id,
    'occurrenceId', v_occurrence.id,
    'productCreated', v_product_created,
    'occurrenceCount', v_product.occurrence_count,
    'firstFluigRequestId', v_product.first_fluig_request_id,
    'lastFluigRequestId', v_product.last_fluig_request_id,
    'lastUnitPriceCents', v_product.last_unit_price_cents,
    'classification', v_product.classification,
    'classificationSource', v_product.classification_source,
    'genericDescriptionGuard', v_generic_description,
    'reviewRequired', v_product.review_required
  );
end;
$$;

alter table public.app_product_categories enable row level security;
alter table public.app_product_material_types enable row level security;
alter table public.app_products enable row level security;
alter table public.app_product_occurrences enable row level security;
alter table public.app_product_branch_links enable row level security;
alter table public.app_product_price_history enable row level security;
alter table public.app_product_audit_events enable row level security;

create policy "approved_product_users_read_categories"
  on public.app_product_categories for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      join public.app_user_page_access page_access
        on page_access.user_id = profile.id
       and page_access.page_slug = 'produtos'
       and page_access.can_view
      where profile.auth_user_id = (select auth.uid())
        and profile.active
        and profile.approval_status = 'APPROVED'
    )
  );

create policy "approved_product_users_read_material_types"
  on public.app_product_material_types for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      join public.app_user_page_access page_access
        on page_access.user_id = profile.id
       and page_access.page_slug = 'produtos'
       and page_access.can_view
      where profile.auth_user_id = (select auth.uid())
        and profile.active
        and profile.approval_status = 'APPROVED'
    )
  );

create policy "branch_scoped_product_read"
  on public.app_products for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.app_user_profiles profile
      join public.app_user_page_access page_access
        on page_access.user_id = profile.id
       and page_access.page_slug = 'produtos'
       and page_access.can_view
      where profile.auth_user_id = (select auth.uid())
        and profile.active
        and profile.approval_status = 'APPROVED'
        and (
          profile.role in ('ADMIN_MASTER', 'ADMIN')
          or exists (
            select 1
            from public.app_product_branch_links branch_link
            join public.app_user_branch_access branch_access
              on branch_access.user_id = profile.id
             and branch_access.branch_id = branch_link.branch_id
             and branch_access.can_view
            where branch_link.product_id = app_products.id
              and branch_link.active
          )
          or exists (
            select 1
            from public.app_product_occurrences occurrence
            join public.app_user_branch_access branch_access
              on branch_access.user_id = profile.id
             and branch_access.can_view
            left join public.app_branches branch
              on branch.id = branch_access.branch_id
            where occurrence.product_id = app_products.id
              and (
                occurrence.branch_id = branch_access.branch_id
                or occurrence.branch_code = branch.code
              )
          )
        )
    )
  );

create policy "branch_scoped_product_branch_link_read"
  on public.app_product_branch_links for select
  to authenticated
  using (
    active
    and exists (
      select 1
      from public.app_user_profiles profile
      join public.app_user_page_access page_access
        on page_access.user_id = profile.id
       and page_access.page_slug = 'produtos'
       and page_access.can_view
      where profile.auth_user_id = (select auth.uid())
        and profile.active
        and profile.approval_status = 'APPROVED'
        and (
          profile.role in ('ADMIN_MASTER', 'ADMIN')
          or exists (
            select 1
            from public.app_user_branch_access branch_access
            where branch_access.user_id = profile.id
              and branch_access.branch_id = app_product_branch_links.branch_id
              and branch_access.can_view
          )
        )
    )
  );

create policy "branch_scoped_product_occurrence_read"
  on public.app_product_occurrences for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      join public.app_user_page_access page_access
        on page_access.user_id = profile.id
       and page_access.page_slug = 'produtos'
       and page_access.can_view
      where profile.auth_user_id = (select auth.uid())
        and profile.active
        and profile.approval_status = 'APPROVED'
        and (
          profile.role in ('ADMIN_MASTER', 'ADMIN')
          or exists (
            select 1
            from public.app_user_branch_access branch_access
            left join public.app_branches branch
              on branch.id = branch_access.branch_id
            where branch_access.user_id = profile.id
              and branch_access.can_view
              and (
                app_product_occurrences.branch_id = branch_access.branch_id
                or app_product_occurrences.branch_code = branch.code
              )
          )
        )
    )
  );

create policy "branch_scoped_product_price_read"
  on public.app_product_price_history for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_product_occurrences occurrence
      where occurrence.id = app_product_price_history.occurrence_id
    )
  );

create policy "branch_scoped_product_audit_read"
  on public.app_product_audit_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_products product
      where product.id = app_product_audit_events.product_id
    )
  );

revoke all on table
  public.app_product_categories,
  public.app_product_material_types,
  public.app_products,
  public.app_product_occurrences,
  public.app_product_branch_links,
  public.app_product_price_history,
  public.app_product_audit_events
from public, anon, authenticated;

grant select on table
  public.app_product_categories,
  public.app_product_material_types,
  public.app_products,
  public.app_product_occurrences,
  public.app_product_branch_links,
  public.app_product_price_history,
  public.app_product_audit_events
to authenticated;

grant select, insert, update on table
  public.app_product_categories,
  public.app_product_material_types,
  public.app_products,
  public.app_product_occurrences
to service_role;

grant select, insert, update, delete on table public.app_product_branch_links to service_role;

grant select, insert on table
  public.app_product_price_history,
  public.app_product_audit_events
to service_role;

revoke execute on function public.normalize_product_catalog_text(text) from public, anon, authenticated;
revoke execute on function public.is_generic_product_description(text, text, text) from public, anon, authenticated;
revoke execute on function public.set_product_reference_normalized_fields() from public, anon, authenticated;
revoke execute on function public.set_app_product_category_source_fields() from public, anon, authenticated;
revoke execute on function public.set_app_product_normalized_fields() from public, anon, authenticated;
revoke execute on function public.set_app_product_occurrence_fields() from public, anon, authenticated;
revoke execute on function public.set_app_product_branch_link_fields() from public, anon, authenticated;
revoke execute on function public.upsert_fluig_product_history(
  text, text, text, integer, text, text, text, text, text, text, text, text, text,
  text, numeric, bigint, bigint, text, timestamptz, text, text, numeric, text,
  boolean, text, text, text, jsonb, jsonb, uuid
) from public, anon, authenticated;

grant execute on function public.normalize_product_catalog_text(text) to service_role;
grant execute on function public.is_generic_product_description(text, text, text) to service_role;
grant execute on function public.set_product_reference_normalized_fields() to service_role;
grant execute on function public.set_app_product_category_source_fields() to service_role;
grant execute on function public.set_app_product_normalized_fields() to service_role;
grant execute on function public.set_app_product_occurrence_fields() to service_role;
grant execute on function public.set_app_product_branch_link_fields() to service_role;
grant execute on function public.upsert_fluig_product_history(
  text, text, text, integer, text, text, text, text, text, text, text, text, text,
  text, numeric, bigint, bigint, text, timestamptz, text, text, numeric, text,
  boolean, text, text, text, jsonb, jsonb, uuid
) to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();

drop policy if exists "authenticated_read_product_images" on storage.objects;
create policy "authenticated_read_product_images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.app_products product
      where product.image_path = storage.objects.name
    )
  );

drop policy if exists "restrict_authenticated_product_image_read_scope" on storage.objects;
create policy "restrict_authenticated_product_image_read_scope"
  on storage.objects as restrictive for select
  to authenticated
  using (
    bucket_id <> 'product-images'
    or exists (
      select 1
      from public.app_products product
      where product.image_path = storage.objects.name
    )
  );

drop policy if exists "deny_anon_product_image_read" on storage.objects;
create policy "deny_anon_product_image_read"
  on storage.objects as restrictive for select
  to anon
  using (bucket_id <> 'product-images');

drop policy if exists "deny_client_product_image_insert" on storage.objects;
create policy "deny_client_product_image_insert"
  on storage.objects as restrictive for insert
  to anon, authenticated
  with check (bucket_id <> 'product-images');

drop policy if exists "deny_client_product_image_update" on storage.objects;
create policy "deny_client_product_image_update"
  on storage.objects as restrictive for update
  to anon, authenticated
  using (bucket_id <> 'product-images')
  with check (bucket_id <> 'product-images');

drop policy if exists "deny_client_product_image_delete" on storage.objects;
create policy "deny_client_product_image_delete"
  on storage.objects as restrictive for delete
  to anon, authenticated
  using (bucket_id <> 'product-images');
