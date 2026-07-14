create table if not exists public.app_maintenance_materials (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.app_products(id) on delete set null,
  code text not null,
  sku text,
  barcode text,
  name text not null,
  description text,
  category text,
  unit text not null default 'UN',
  brand text,
  model text,
  compatible_asset_categories uuid[] not null default '{}',
  primary_supplier_id uuid references public.app_suppliers(id) on delete set null,
  alternate_supplier_ids uuid[] not null default '{}',
  average_cost_cents bigint not null default 0,
  last_cost_cents bigint not null default 0,
  minimum_stock numeric(18,3) not null default 0,
  maximum_stock numeric(18,3),
  reorder_point numeric(18,3) not null default 0,
  lead_time_days integer not null default 0,
  image_path text,
  active boolean not null default true,
  lot_control boolean not null default false,
  expiry_control boolean not null default false,
  serial_control boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_materials_code_not_blank check (btrim(code) <> ''),
  constraint app_maintenance_materials_name_not_blank check (btrim(name) <> ''),
  constraint app_maintenance_materials_unit_not_blank check (btrim(unit) <> ''),
  constraint app_maintenance_materials_values_check check (
    average_cost_cents >= 0 and last_cost_cents >= 0 and minimum_stock >= 0
    and (maximum_stock is null or maximum_stock >= minimum_stock)
    and reorder_point >= 0 and lead_time_days >= 0
  )
);
create unique index if not exists app_maintenance_materials_code_uidx
  on public.app_maintenance_materials(upper(btrim(code))) where deleted_at is null;
create unique index if not exists app_maintenance_materials_product_uidx
  on public.app_maintenance_materials(product_id) where deleted_at is null and product_id is not null;
create unique index if not exists app_maintenance_materials_barcode_uidx
  on public.app_maintenance_materials(barcode) where deleted_at is null and barcode is not null;
create index if not exists app_maintenance_materials_filter_idx
  on public.app_maintenance_materials(active, category, name) where deleted_at is null;
create index if not exists app_maintenance_materials_supplier_idx
  on public.app_maintenance_materials(primary_supplier_id) where deleted_at is null;

create table if not exists public.app_maintenance_warehouses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.app_branches(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  responsible_user_id uuid references public.app_user_profiles(id) on delete set null,
  allow_negative_stock boolean not null default false,
  active boolean not null default true,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_warehouses_code_not_blank check (btrim(code) <> ''),
  constraint app_maintenance_warehouses_name_not_blank check (btrim(name) <> '')
);
create unique index if not exists app_maintenance_warehouses_branch_code_uidx
  on public.app_maintenance_warehouses(branch_id, upper(btrim(code))) where deleted_at is null;
create index if not exists app_maintenance_warehouses_responsible_idx
  on public.app_maintenance_warehouses(responsible_user_id) where deleted_at is null;

create table if not exists public.app_maintenance_storage_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.app_maintenance_warehouses(id) on delete restrict,
  code text not null,
  aisle text,
  shelf text,
  position text,
  description text,
  blocked boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_storage_locations_code_not_blank check (btrim(code) <> '')
);
create unique index if not exists app_maintenance_storage_locations_warehouse_code_uidx
  on public.app_maintenance_storage_locations(warehouse_id, upper(btrim(code))) where deleted_at is null;
create index if not exists app_maintenance_storage_locations_warehouse_idx
  on public.app_maintenance_storage_locations(warehouse_id) where deleted_at is null;

create table if not exists public.app_maintenance_stock_balances (
  id bigint generated always as identity primary key,
  material_id uuid not null references public.app_maintenance_materials(id) on delete restrict,
  location_id uuid not null references public.app_maintenance_storage_locations(id) on delete restrict,
  quantity_on_hand numeric(18,3) not null default 0,
  quantity_reserved numeric(18,3) not null default 0,
  quantity_in_transit numeric(18,3) not null default 0,
  quantity_blocked numeric(18,3) not null default 0,
  average_cost_cents bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint app_maintenance_stock_balances_material_location_uidx unique(material_id, location_id),
  constraint app_maintenance_stock_balances_values_check check (
    quantity_on_hand >= 0 and quantity_reserved >= 0 and quantity_in_transit >= 0
    and quantity_blocked >= 0 and quantity_reserved + quantity_blocked <= quantity_on_hand
    and average_cost_cents >= 0
  )
);
create index if not exists app_maintenance_stock_balances_location_idx
  on public.app_maintenance_stock_balances(location_id, material_id);
create index if not exists app_maintenance_stock_balances_replenishment_idx
  on public.app_maintenance_stock_balances(material_id, quantity_on_hand, quantity_reserved);

create table if not exists public.app_maintenance_order_materials (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.app_maintenance_orders(id) on delete cascade,
  material_id uuid not null references public.app_maintenance_materials(id) on delete restrict,
  planned_quantity numeric(18,3) not null default 0,
  reserved_quantity numeric(18,3) not null default 0,
  consumed_quantity numeric(18,3) not null default 0,
  returned_quantity numeric(18,3) not null default 0,
  unit_cost_cents bigint not null default 0,
  notes text,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_maintenance_order_materials_order_material_uidx unique(order_id, material_id),
  constraint app_maintenance_order_materials_values_check check (
    planned_quantity >= 0 and reserved_quantity >= 0 and consumed_quantity >= 0
    and returned_quantity >= 0 and unit_cost_cents >= 0
  )
);
create index if not exists app_maintenance_order_materials_material_idx
  on public.app_maintenance_order_materials(material_id, order_id);

create table if not exists public.app_maintenance_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.app_maintenance_orders(id) on delete restrict,
  material_id uuid not null references public.app_maintenance_materials(id) on delete restrict,
  location_id uuid not null references public.app_maintenance_storage_locations(id) on delete restrict,
  requested_quantity numeric(18,3) not null,
  reserved_quantity numeric(18,3) not null,
  consumed_quantity numeric(18,3) not null default 0,
  released_quantity numeric(18,3) not null default 0,
  status text not null default 'ACTIVE',
  reserved_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  reserved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_maintenance_stock_reservations_status_check check (status in ('ACTIVE', 'PARTIAL', 'RELEASED', 'CONSUMED', 'CANCELLED')),
  constraint app_maintenance_stock_reservations_values_check check (
    requested_quantity > 0 and reserved_quantity > 0 and consumed_quantity >= 0 and released_quantity >= 0
    and consumed_quantity + released_quantity <= reserved_quantity
  )
);
create unique index if not exists app_maintenance_stock_reservations_active_uidx
  on public.app_maintenance_stock_reservations(order_id, material_id, location_id)
  where status in ('ACTIVE', 'PARTIAL');
create index if not exists app_maintenance_stock_reservations_order_idx
  on public.app_maintenance_stock_reservations(order_id, status);
create index if not exists app_maintenance_stock_reservations_balance_idx
  on public.app_maintenance_stock_reservations(material_id, location_id, status);

create table if not exists public.app_maintenance_stock_movements (
  id bigint generated always as identity primary key,
  movement_type text not null,
  material_id uuid not null references public.app_maintenance_materials(id) on delete restrict,
  quantity numeric(18,3) not null,
  unit text not null,
  from_location_id uuid references public.app_maintenance_storage_locations(id) on delete restrict,
  to_location_id uuid references public.app_maintenance_storage_locations(id) on delete restrict,
  work_order_id uuid references public.app_maintenance_orders(id) on delete set null,
  asset_id uuid references public.app_maintenance_assets(id) on delete set null,
  reservation_id uuid references public.app_maintenance_stock_reservations(id) on delete set null,
  inventory_count_id uuid,
  document_number text,
  unit_cost_cents bigint not null default 0,
  total_cost_cents bigint not null default 0,
  from_quantity_before numeric(18,3),
  from_quantity_after numeric(18,3),
  to_quantity_before numeric(18,3),
  to_quantity_after numeric(18,3),
  reason text not null,
  notes text,
  reversal_of_movement_id bigint references public.app_maintenance_stock_movements(id) on delete restrict,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint app_maintenance_stock_movements_type_check check (movement_type in (
    'PURCHASE_IN', 'MANUAL_IN', 'WORK_ORDER_OUT', 'RETURN_FROM_ORDER', 'TRANSFER',
    'POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'LOSS', 'DAMAGE', 'INVENTORY_IN',
    'INVENTORY_OUT', 'WRITE_OFF', 'REVERSAL_IN', 'REVERSAL_OUT'
  )),
  constraint app_maintenance_stock_movements_values_check check (quantity > 0 and unit_cost_cents >= 0 and total_cost_cents >= 0),
  constraint app_maintenance_stock_movements_location_check check (from_location_id is not null or to_location_id is not null)
);
create index if not exists app_maintenance_stock_movements_material_idx
  on public.app_maintenance_stock_movements(material_id, occurred_at desc);
create index if not exists app_maintenance_stock_movements_order_idx
  on public.app_maintenance_stock_movements(work_order_id, occurred_at desc) where work_order_id is not null;
create index if not exists app_maintenance_stock_movements_from_idx
  on public.app_maintenance_stock_movements(from_location_id, occurred_at desc) where from_location_id is not null;
create index if not exists app_maintenance_stock_movements_to_idx
  on public.app_maintenance_stock_movements(to_location_id, occurred_at desc) where to_location_id is not null;

create table if not exists public.app_maintenance_order_labor (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.app_maintenance_orders(id) on delete cascade,
  user_id uuid references public.app_user_profiles(id) on delete set null,
  service_provider_id uuid references public.app_maintenance_service_providers(id) on delete set null,
  professional_name text,
  started_at timestamptz not null,
  ended_at timestamptz,
  minutes integer,
  hourly_cost_cents bigint not null default 0,
  total_cost_cents bigint not null default 0,
  notes text,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_maintenance_order_labor_time_check check (ended_at is null or ended_at >= started_at),
  constraint app_maintenance_order_labor_values_check check (
    (minutes is null or minutes >= 0) and hourly_cost_cents >= 0 and total_cost_cents >= 0
  )
);
create index if not exists app_maintenance_order_labor_order_idx
  on public.app_maintenance_order_labor(order_id, started_at desc);

create table if not exists public.app_maintenance_order_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.app_maintenance_orders(id) on delete cascade,
  attachment_type text not null default 'DOCUMENT',
  name text not null,
  bucket text,
  path text,
  mime_type text,
  size_bytes bigint,
  description text,
  legacy_key text,
  uploaded_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_order_attachments_type_check check (attachment_type in ('BEFORE_PHOTO', 'AFTER_PHOTO', 'DOCUMENT', 'INVOICE', 'SIGNATURE', 'OTHER')),
  constraint app_maintenance_order_attachments_size_check check (size_bytes is null or size_bytes >= 0)
);
create unique index if not exists app_maintenance_order_attachments_path_uidx
  on public.app_maintenance_order_attachments(bucket, path) where deleted_at is null and path is not null;
create unique index if not exists app_maintenance_order_attachments_legacy_uidx
  on public.app_maintenance_order_attachments(order_id, legacy_key) where legacy_key is not null;
create index if not exists app_maintenance_order_attachments_order_idx
  on public.app_maintenance_order_attachments(order_id, created_at desc) where deleted_at is null;

create table if not exists public.app_maintenance_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  asset_category_id uuid references public.app_maintenance_asset_categories(id) on delete set null,
  active boolean not null default true,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists app_maintenance_checklist_templates_code_uidx
  on public.app_maintenance_checklist_templates(upper(btrim(code))) where deleted_at is null;

create table if not exists public.app_maintenance_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.app_maintenance_checklist_templates(id) on delete cascade,
  position integer not null,
  label text not null,
  response_type text not null default 'BOOLEAN',
  required boolean not null default false,
  requires_evidence_on_failure boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint app_maintenance_checklist_items_position_uidx unique(template_id, position),
  constraint app_maintenance_checklist_items_response_check check (response_type in ('BOOLEAN', 'TEXT', 'NUMBER', 'SELECT', 'PHOTO'))
);

create table if not exists public.app_maintenance_checklist_executions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.app_maintenance_orders(id) on delete cascade,
  template_id uuid not null references public.app_maintenance_checklist_templates(id) on delete restrict,
  item_id uuid not null references public.app_maintenance_checklist_items(id) on delete restrict,
  response jsonb not null default '{}'::jsonb,
  compliant boolean,
  notes text,
  executed_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  executed_at timestamptz not null default now(),
  constraint app_maintenance_checklist_executions_item_uidx unique(order_id, item_id)
);
create index if not exists app_maintenance_checklist_executions_order_idx
  on public.app_maintenance_checklist_executions(order_id, executed_at);

create table if not exists public.app_maintenance_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  inventory_type text not null,
  branch_id uuid not null references public.app_branches(id) on delete restrict,
  warehouse_id uuid references public.app_maintenance_warehouses(id) on delete restrict,
  area text,
  status text not null default 'DRAFT',
  reference_frozen_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  notes text,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_maintenance_inventory_counts_type_check check (inventory_type in ('MATERIAL', 'ASSET')),
  constraint app_maintenance_inventory_counts_status_check check (status in ('DRAFT', 'COUNTING', 'RECOUNT', 'SUBMITTED', 'APPROVED', 'CANCELLED'))
);
create index if not exists app_maintenance_inventory_counts_branch_idx
  on public.app_maintenance_inventory_counts(branch_id, inventory_type, status, created_at desc);
create index if not exists app_maintenance_inventory_counts_warehouse_idx
  on public.app_maintenance_inventory_counts(warehouse_id) where warehouse_id is not null;

create table if not exists public.app_maintenance_inventory_items (
  id uuid primary key default gen_random_uuid(),
  inventory_count_id uuid not null references public.app_maintenance_inventory_counts(id) on delete cascade,
  material_id uuid references public.app_maintenance_materials(id) on delete restrict,
  asset_id uuid references public.app_maintenance_assets(id) on delete restrict,
  location_id uuid references public.app_maintenance_storage_locations(id) on delete restrict,
  reference_quantity numeric(18,3),
  first_count_quantity numeric(18,3),
  first_counter_user_id uuid references public.app_user_profiles(id) on delete set null,
  first_counted_at timestamptz,
  second_count_quantity numeric(18,3),
  second_counter_user_id uuid references public.app_user_profiles(id) on delete set null,
  second_counted_at timestamptz,
  asset_found boolean,
  found_location text,
  condition text,
  photo_path text,
  variance_quantity numeric(18,3),
  justification text,
  resolution text,
  adjustment_movement_id bigint references public.app_maintenance_stock_movements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_maintenance_inventory_items_subject_check check (
    (material_id is not null and asset_id is null) or (material_id is null and asset_id is not null)
  ),
  constraint app_maintenance_inventory_items_values_check check (
    (reference_quantity is null or reference_quantity >= 0)
    and (first_count_quantity is null or first_count_quantity >= 0)
    and (second_count_quantity is null or second_count_quantity >= 0)
  )
);
create unique index if not exists app_maintenance_inventory_items_material_uidx
  on public.app_maintenance_inventory_items(inventory_count_id, material_id, location_id)
  where material_id is not null;
create unique index if not exists app_maintenance_inventory_items_asset_uidx
  on public.app_maintenance_inventory_items(inventory_count_id, asset_id)
  where asset_id is not null;
create index if not exists app_maintenance_inventory_items_count_idx
  on public.app_maintenance_inventory_items(inventory_count_id);

alter table public.app_maintenance_stock_movements
  drop constraint if exists app_maintenance_stock_movements_inventory_count_id_fkey;
alter table public.app_maintenance_stock_movements
  add constraint app_maintenance_stock_movements_inventory_count_id_fkey
  foreign key (inventory_count_id) references public.app_maintenance_inventory_counts(id) on delete set null;

create or replace function public.app_maintenance_recalculate_order_cost(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  material_total bigint;
  labor_total bigint;
begin
  select coalesce(sum(round(consumed_quantity * unit_cost_cents)), 0)::bigint
    into material_total
  from public.app_maintenance_order_materials
  where order_id = p_order_id;

  select coalesce(sum(total_cost_cents), 0)::bigint
    into labor_total
  from public.app_maintenance_order_labor
  where order_id = p_order_id;

  update public.app_maintenance_orders
  set material_cost_cents = material_total,
      labor_cost_cents = labor_total,
      total_cost_cents = material_total + labor_total + other_cost_cents,
      updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.app_maintenance_post_stock_movement(
  p_movement_type text,
  p_material_id uuid,
  p_quantity numeric,
  p_from_location_id uuid default null,
  p_to_location_id uuid default null,
  p_work_order_id uuid default null,
  p_asset_id uuid default null,
  p_inventory_count_id uuid default null,
  p_unit_cost_cents bigint default 0,
  p_actor_user_id uuid default null,
  p_reason text default 'Movimentacao de estoque',
  p_document_number text default null,
  p_notes text default null,
  p_allow_negative boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement_id bigint;
  material_unit text;
  from_before numeric(18,3);
  from_after numeric(18,3);
  to_before numeric(18,3);
  to_after numeric(18,3);
  from_reserved numeric(18,3);
  from_blocked numeric(18,3);
  warehouse_allows_negative boolean := false;
  inbound boolean;
  outbound boolean;
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  if p_unit_cost_cents < 0 then raise exception 'Custo unitario invalido.'; end if;

  inbound := p_movement_type in ('PURCHASE_IN', 'MANUAL_IN', 'RETURN_FROM_ORDER', 'POSITIVE_ADJUSTMENT', 'INVENTORY_IN', 'REVERSAL_IN');
  outbound := p_movement_type in ('WORK_ORDER_OUT', 'NEGATIVE_ADJUSTMENT', 'LOSS', 'DAMAGE', 'INVENTORY_OUT', 'WRITE_OFF', 'REVERSAL_OUT');
  if not inbound and not outbound and p_movement_type <> 'TRANSFER' then raise exception 'Tipo de movimentacao invalido.'; end if;
  if (outbound or p_movement_type = 'TRANSFER') and p_from_location_id is null then raise exception 'Local de origem obrigatorio.'; end if;
  if (inbound or p_movement_type = 'TRANSFER') and p_to_location_id is null then raise exception 'Local de destino obrigatorio.'; end if;
  if p_movement_type = 'TRANSFER' and p_from_location_id = p_to_location_id then raise exception 'Origem e destino devem ser diferentes.'; end if;

  select unit into material_unit from public.app_maintenance_materials where id = p_material_id and deleted_at is null and active;
  if material_unit is null then raise exception 'Material inexistente ou inativo.'; end if;

  if p_from_location_id is not null then
    insert into public.app_maintenance_stock_balances(material_id, location_id)
    values (p_material_id, p_from_location_id) on conflict (material_id, location_id) do nothing;
  end if;
  if p_to_location_id is not null then
    insert into public.app_maintenance_stock_balances(material_id, location_id)
    values (p_material_id, p_to_location_id) on conflict (material_id, location_id) do nothing;
  end if;

  perform 1 from public.app_maintenance_stock_balances
  where material_id = p_material_id and location_id in (p_from_location_id, p_to_location_id)
  order by location_id for update;

  if p_from_location_id is not null then
    select b.quantity_on_hand, b.quantity_reserved, b.quantity_blocked, w.allow_negative_stock
      into from_before, from_reserved, from_blocked, warehouse_allows_negative
    from public.app_maintenance_stock_balances b
    join public.app_maintenance_storage_locations l on l.id = b.location_id
    join public.app_maintenance_warehouses w on w.id = l.warehouse_id
    where b.material_id = p_material_id and b.location_id = p_from_location_id;
    if from_before - from_reserved - from_blocked < p_quantity and not (p_allow_negative and warehouse_allows_negative) then
      raise exception 'Saldo disponivel insuficiente. Disponivel: %', from_before - from_reserved - from_blocked;
    end if;
    from_after := from_before - p_quantity;
    if from_after < 0 then raise exception 'Saldo fisico negativo nao permitido.'; end if;
    update public.app_maintenance_stock_balances
    set quantity_on_hand = from_after, updated_at = now()
    where material_id = p_material_id and location_id = p_from_location_id;
  end if;

  if p_to_location_id is not null then
    select quantity_on_hand into to_before from public.app_maintenance_stock_balances
    where material_id = p_material_id and location_id = p_to_location_id;
    to_after := to_before + p_quantity;
    update public.app_maintenance_stock_balances
    set quantity_on_hand = to_after,
        average_cost_cents = case
          when p_unit_cost_cents > 0 and to_after > 0
            then round(((to_before * average_cost_cents) + (p_quantity * p_unit_cost_cents)) / to_after)::bigint
          else average_cost_cents
        end,
        updated_at = now()
    where material_id = p_material_id and location_id = p_to_location_id;
  end if;

  insert into public.app_maintenance_stock_movements(
    movement_type, material_id, quantity, unit, from_location_id, to_location_id, work_order_id,
    asset_id, inventory_count_id, document_number, unit_cost_cents, total_cost_cents,
    from_quantity_before, from_quantity_after, to_quantity_before, to_quantity_after,
    reason, notes, actor_user_id
  ) values (
    p_movement_type, p_material_id, p_quantity, material_unit, p_from_location_id, p_to_location_id, p_work_order_id,
    p_asset_id, p_inventory_count_id, p_document_number, p_unit_cost_cents, round(p_quantity * p_unit_cost_cents)::bigint,
    from_before, from_after, to_before, to_after, coalesce(nullif(btrim(p_reason), ''), 'Movimentacao de estoque'), p_notes, p_actor_user_id
  ) returning id into movement_id;

  insert into public.app_maintenance_audit_events(entity_type, entity_id, action, actor_user_id, after_data)
  values ('STOCK_MOVEMENT', movement_id::text, p_movement_type, p_actor_user_id, jsonb_build_object('materialId', p_material_id, 'quantity', p_quantity, 'fromLocationId', p_from_location_id, 'toLocationId', p_to_location_id));
  return movement_id;
end;
$$;

create or replace function public.app_maintenance_reserve_stock(
  p_order_id uuid,
  p_material_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_id uuid;
  available numeric(18,3);
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  if not exists(select 1 from public.app_maintenance_orders where id = p_order_id and deleted_at is null and status not in ('FINALIZADA', 'CANCELADA')) then
    raise exception 'OS inexistente ou encerrada.';
  end if;
  insert into public.app_maintenance_stock_balances(material_id, location_id)
  values (p_material_id, p_location_id) on conflict (material_id, location_id) do nothing;
  select quantity_on_hand - quantity_reserved - quantity_blocked into available
  from public.app_maintenance_stock_balances
  where material_id = p_material_id and location_id = p_location_id for update;
  if available < p_quantity then raise exception 'Saldo disponivel insuficiente. Disponivel: %', available; end if;

  select id into reservation_id from public.app_maintenance_stock_reservations
  where order_id = p_order_id and material_id = p_material_id and location_id = p_location_id and status in ('ACTIVE', 'PARTIAL')
  for update;
  if reservation_id is null then
    insert into public.app_maintenance_stock_reservations(order_id, material_id, location_id, requested_quantity, reserved_quantity, reserved_by_user_id)
    values (p_order_id, p_material_id, p_location_id, p_quantity, p_quantity, p_actor_user_id)
    returning id into reservation_id;
  else
    update public.app_maintenance_stock_reservations
    set requested_quantity = requested_quantity + p_quantity,
        reserved_quantity = reserved_quantity + p_quantity,
        status = 'ACTIVE', updated_at = now()
    where id = reservation_id;
  end if;

  update public.app_maintenance_stock_balances
  set quantity_reserved = quantity_reserved + p_quantity, updated_at = now()
  where material_id = p_material_id and location_id = p_location_id;
  insert into public.app_maintenance_order_materials(order_id, material_id, reserved_quantity, created_by_user_id, updated_by_user_id)
  values (p_order_id, p_material_id, p_quantity, p_actor_user_id, p_actor_user_id)
  on conflict (order_id, material_id) do update
  set reserved_quantity = public.app_maintenance_order_materials.reserved_quantity + excluded.reserved_quantity,
      updated_by_user_id = excluded.updated_by_user_id, updated_at = now();
  insert into public.app_maintenance_order_events(order_id, actor_user_id, event_type, event_label, event_payload)
  values (p_order_id, p_actor_user_id, 'MATERIAL_RESERVED', 'Material reservado', jsonb_build_object('reservationId', reservation_id, 'materialId', p_material_id, 'quantity', p_quantity, 'locationId', p_location_id));
  return reservation_id;
end;
$$;

create or replace function public.app_maintenance_consume_reservation(
  p_reservation_id uuid,
  p_quantity numeric,
  p_unit_cost_cents bigint,
  p_actor_user_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.app_maintenance_stock_reservations%rowtype;
  balance_before numeric(18,3);
  balance_after numeric(18,3);
  reserved_after numeric(18,3);
  material_unit text;
  movement_id bigint;
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  if p_unit_cost_cents is null or p_unit_cost_cents < 0 then raise exception 'Custo unitario invalido.'; end if;
  select * into reservation from public.app_maintenance_stock_reservations where id = p_reservation_id for update;
  if reservation.id is null or reservation.status not in ('ACTIVE', 'PARTIAL') then raise exception 'Reserva inexistente ou encerrada.'; end if;
  if reservation.reserved_quantity - reservation.consumed_quantity - reservation.released_quantity < p_quantity then raise exception 'Quantidade excede o saldo da reserva.'; end if;
  select quantity_on_hand, quantity_reserved into balance_before, reserved_after
  from public.app_maintenance_stock_balances
  where material_id = reservation.material_id and location_id = reservation.location_id for update;
  if balance_before < p_quantity or reserved_after < p_quantity then raise exception 'Saldo fisico ou reservado inconsistente.'; end if;
  balance_after := balance_before - p_quantity;
  select unit into material_unit from public.app_maintenance_materials where id = reservation.material_id;

  update public.app_maintenance_stock_balances
  set quantity_on_hand = balance_after, quantity_reserved = quantity_reserved - p_quantity, updated_at = now()
  where material_id = reservation.material_id and location_id = reservation.location_id;
  update public.app_maintenance_stock_reservations
  set consumed_quantity = consumed_quantity + p_quantity,
      status = case when consumed_quantity + released_quantity + p_quantity = reserved_quantity then 'CONSUMED' else 'PARTIAL' end,
      updated_at = now()
  where id = reservation.id;
  update public.app_maintenance_order_materials
  set reserved_quantity = greatest(0, reserved_quantity - p_quantity),
      consumed_quantity = consumed_quantity + p_quantity,
      unit_cost_cents = p_unit_cost_cents,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where order_id = reservation.order_id and material_id = reservation.material_id;

  insert into public.app_maintenance_stock_movements(
    movement_type, material_id, quantity, unit, from_location_id, work_order_id, reservation_id,
    unit_cost_cents, total_cost_cents, from_quantity_before, from_quantity_after, reason, actor_user_id
  ) values (
    'WORK_ORDER_OUT', reservation.material_id, p_quantity, material_unit, reservation.location_id, reservation.order_id, reservation.id,
    p_unit_cost_cents, round(p_quantity * p_unit_cost_cents)::bigint, balance_before, balance_after, 'Consumo em OS', p_actor_user_id
  ) returning id into movement_id;
  perform public.app_maintenance_recalculate_order_cost(reservation.order_id);
  insert into public.app_maintenance_order_events(order_id, actor_user_id, event_type, event_label, event_payload)
  values (reservation.order_id, p_actor_user_id, 'MATERIAL_CONSUMED', 'Material consumido', jsonb_build_object('reservationId', reservation.id, 'movementId', movement_id, 'materialId', reservation.material_id, 'quantity', p_quantity));
  return movement_id;
end;
$$;

create or replace function public.app_maintenance_release_reservation(
  p_reservation_id uuid,
  p_quantity numeric default null,
  p_actor_user_id uuid default null,
  p_reason text default 'Liberacao de reserva'
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.app_maintenance_stock_reservations%rowtype;
  remaining numeric(18,3);
  release_quantity numeric(18,3);
begin
  select * into reservation from public.app_maintenance_stock_reservations where id = p_reservation_id for update;
  if reservation.id is null or reservation.status not in ('ACTIVE', 'PARTIAL') then raise exception 'Reserva inexistente ou encerrada.'; end if;
  remaining := reservation.reserved_quantity - reservation.consumed_quantity - reservation.released_quantity;
  release_quantity := coalesce(p_quantity, remaining);
  if release_quantity <= 0 or release_quantity > remaining then raise exception 'Quantidade de liberacao invalida.'; end if;
  perform 1 from public.app_maintenance_stock_balances
  where material_id = reservation.material_id and location_id = reservation.location_id for update;
  update public.app_maintenance_stock_balances
  set quantity_reserved = quantity_reserved - release_quantity, updated_at = now()
  where material_id = reservation.material_id and location_id = reservation.location_id;
  update public.app_maintenance_stock_reservations
  set released_quantity = released_quantity + release_quantity,
      status = case when consumed_quantity + released_quantity + release_quantity = reserved_quantity then 'RELEASED' else 'PARTIAL' end,
      updated_at = now()
  where id = reservation.id;
  update public.app_maintenance_order_materials
  set reserved_quantity = greatest(0, reserved_quantity - release_quantity), updated_by_user_id = p_actor_user_id, updated_at = now()
  where order_id = reservation.order_id and material_id = reservation.material_id;
  insert into public.app_maintenance_order_events(order_id, actor_user_id, event_type, event_label, event_payload)
  values (reservation.order_id, p_actor_user_id, 'MATERIAL_RELEASED', coalesce(nullif(btrim(p_reason), ''), 'Material liberado'), jsonb_build_object('reservationId', reservation.id, 'materialId', reservation.material_id, 'quantity', release_quantity));
  return release_quantity;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_maintenance_materials', 'app_maintenance_warehouses', 'app_maintenance_storage_locations',
    'app_maintenance_stock_balances', 'app_maintenance_order_materials', 'app_maintenance_stock_reservations',
    'app_maintenance_order_labor', 'app_maintenance_inventory_counts', 'app_maintenance_inventory_items'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'set_' || table_name || '_updated_at', table_name);
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_maintenance_materials', 'app_maintenance_warehouses', 'app_maintenance_storage_locations',
    'app_maintenance_stock_balances', 'app_maintenance_order_materials', 'app_maintenance_stock_reservations',
    'app_maintenance_stock_movements', 'app_maintenance_order_labor', 'app_maintenance_order_attachments',
    'app_maintenance_checklist_templates', 'app_maintenance_checklist_items', 'app_maintenance_checklist_executions',
    'app_maintenance_inventory_counts', 'app_maintenance_inventory_items'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_all', table_name);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_all', table_name);
  end loop;
end $$;

revoke execute on function public.app_maintenance_recalculate_order_cost(uuid) from public, anon, authenticated;
revoke execute on function public.app_maintenance_post_stock_movement(text, uuid, numeric, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.app_maintenance_reserve_stock(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.app_maintenance_consume_reservation(uuid, numeric, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.app_maintenance_release_reservation(uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.app_maintenance_recalculate_order_cost(uuid) to service_role;
grant execute on function public.app_maintenance_post_stock_movement(text, uuid, numeric, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, text, boolean) to service_role;
grant execute on function public.app_maintenance_reserve_stock(uuid, uuid, uuid, numeric, uuid) to service_role;
grant execute on function public.app_maintenance_consume_reservation(uuid, numeric, bigint, uuid) to service_role;
grant execute on function public.app_maintenance_release_reservation(uuid, numeric, uuid, text) to service_role;
