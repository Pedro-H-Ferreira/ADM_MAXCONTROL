-- Normalized maintenance domain. Existing app_maintenance_orders remains the
-- canonical work-order table so current links and Fluig references keep working.

create sequence if not exists public.app_maintenance_order_number_seq;

alter table public.app_maintenance_orders
  add column if not exists sequence_number bigint,
  add column if not exists work_type text not null default 'CORRETIVA',
  add column if not exists asset_id uuid,
  add column if not exists service_provider_id uuid,
  add column if not exists preventive_plan_id uuid,
  add column if not exists preventive_due_key text,
  add column if not exists sla_minutes integer,
  add column if not exists diagnosis text,
  add column if not exists root_cause text,
  add column if not exists executed_solution text,
  add column if not exists downtime_minutes integer not null default 0,
  add column if not exists labor_cost_cents bigint not null default 0,
  add column if not exists other_cost_cents bigint not null default 0,
  add column if not exists total_cost_cents bigint not null default 0,
  add column if not exists completion_notes text,
  add column if not exists completion_confirmed_by uuid references public.app_user_profiles(id) on delete set null,
  add column if not exists completion_confirmed_at timestamptz,
  add column if not exists approval_status text not null default 'NOT_REQUIRED',
  add column if not exists approved_by uuid references public.app_user_profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_notes text,
  add column if not exists service_rating smallint;

alter table public.app_maintenance_orders
  alter column sequence_number set default nextval('public.app_maintenance_order_number_seq');

update public.app_maintenance_orders
set sequence_number = nextval('public.app_maintenance_order_number_seq')
where sequence_number is null;

alter table public.app_maintenance_orders
  alter column sequence_number set not null;

alter table public.app_maintenance_orders
  drop constraint if exists app_maintenance_orders_source_check,
  drop constraint if exists app_maintenance_orders_status_check,
  drop constraint if exists app_maintenance_orders_work_type_check,
  drop constraint if exists app_maintenance_orders_approval_status_check,
  drop constraint if exists app_maintenance_orders_service_rating_check,
  drop constraint if exists app_maintenance_orders_sla_minutes_check,
  drop constraint if exists app_maintenance_orders_downtime_minutes_check,
  drop constraint if exists app_maintenance_orders_costs_check;

alter table public.app_maintenance_orders
  add constraint app_maintenance_orders_source_check check (source in ('manual', 'fluig', 'preventiva', 'checklist', 'alerta')),
  add constraint app_maintenance_orders_status_check check (
    status in (
      'ABERTA', 'EM_TRIAGEM', 'PLANEJADA', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_MATERIAL',
      'MATERIAL_RESERVADO', 'AGUARDANDO_TERCEIRO', 'PROGRAMADA', 'INICIADA', 'EM_EXECUCAO',
      'PAUSADA', 'CONCLUIDA', 'AGUARDANDO_VALIDACAO', 'FINALIZADA', 'CANCELADA'
    )
  ),
  add constraint app_maintenance_orders_work_type_check check (work_type in ('CORRETIVA', 'PREVENTIVA', 'INSPECAO', 'MELHORIA', 'EMERGENCIA')),
  add constraint app_maintenance_orders_approval_status_check check (approval_status in ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  add constraint app_maintenance_orders_service_rating_check check (service_rating is null or service_rating between 1 and 5),
  add constraint app_maintenance_orders_sla_minutes_check check (sla_minutes is null or sla_minutes >= 0),
  add constraint app_maintenance_orders_downtime_minutes_check check (downtime_minutes >= 0),
  add constraint app_maintenance_orders_costs_check check (
    labor_cost_cents >= 0 and other_cost_cents >= 0 and total_cost_cents >= 0
  );

create unique index if not exists app_maintenance_orders_sequence_number_uidx
  on public.app_maintenance_orders(sequence_number);
create unique index if not exists app_maintenance_orders_preventive_due_uidx
  on public.app_maintenance_orders(preventive_plan_id, asset_id, preventive_due_key)
  where preventive_plan_id is not null and asset_id is not null and preventive_due_key is not null;
create index if not exists app_maintenance_orders_active_queue_idx
  on public.app_maintenance_orders(branch_id, status, priority, due_at, created_at desc)
  where deleted_at is null and status not in ('FINALIZADA', 'CANCELADA');

create or replace function public.app_set_maintenance_order_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sequence_number is null then
    new.sequence_number := nextval('public.app_maintenance_order_number_seq');
  end if;
  if nullif(btrim(new.code), '') is null then
    new.code := 'OS-' || to_char(coalesce(new.created_at, now()) at time zone 'America/Sao_Paulo', 'YYYY') || '-' || lpad(new.sequence_number::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists set_app_maintenance_order_code on public.app_maintenance_orders;
create trigger set_app_maintenance_order_code
  before insert on public.app_maintenance_orders
  for each row execute function public.app_set_maintenance_order_code();

create table if not exists public.app_maintenance_asset_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.app_maintenance_asset_categories(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  active boolean not null default true,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_asset_categories_code_not_blank check (btrim(code) <> ''),
  constraint app_maintenance_asset_categories_name_not_blank check (btrim(name) <> '')
);
create unique index if not exists app_maintenance_asset_categories_code_uidx
  on public.app_maintenance_asset_categories(upper(btrim(code))) where deleted_at is null;
create index if not exists app_maintenance_asset_categories_parent_idx
  on public.app_maintenance_asset_categories(parent_id) where deleted_at is null;

create table if not exists public.app_maintenance_service_providers (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.app_suppliers(id) on delete set null,
  name text not null,
  tax_id text,
  contact_name text,
  email text,
  phone text,
  specialties text[] not null default '{}',
  sla_minutes integer,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_service_providers_name_not_blank check (btrim(name) <> ''),
  constraint app_maintenance_service_providers_sla_check check (sla_minutes is null or sla_minutes >= 0)
);
create unique index if not exists app_maintenance_service_providers_tax_id_uidx
  on public.app_maintenance_service_providers(regexp_replace(coalesce(tax_id, ''), '\D', '', 'g'))
  where deleted_at is null and nullif(regexp_replace(coalesce(tax_id, ''), '\D', '', 'g'), '') is not null;
create index if not exists app_maintenance_service_providers_supplier_idx
  on public.app_maintenance_service_providers(supplier_id) where deleted_at is null;

create table if not exists public.app_maintenance_assets (
  id uuid primary key default gen_random_uuid(),
  internal_code text not null,
  asset_tag text,
  name text not null,
  category_id uuid references public.app_maintenance_asset_categories(id) on delete restrict,
  subcategory text,
  brand text,
  model text,
  serial_number text,
  description text,
  branch_id uuid not null references public.app_branches(id) on delete restrict,
  area text,
  physical_location text,
  cost_center_code text,
  cost_center_label text,
  responsible_user_id uuid references public.app_user_profiles(id) on delete set null,
  responsible_name text,
  status text not null default 'ATIVO',
  criticality text not null default 'MEDIA',
  acquired_at date,
  acquisition_value_cents bigint,
  supplier_id uuid references public.app_suppliers(id) on delete set null,
  invoice_number text,
  commissioned_at date,
  warranty_months integer,
  warranty_ends_at date,
  useful_life_months integer,
  qr_code text,
  barcode text,
  meter_type text,
  current_meter numeric(18,3) not null default 0,
  last_maintenance_at timestamptz,
  next_maintenance_at timestamptz,
  notes text,
  retired_at timestamptz,
  retirement_reason text,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_assets_internal_code_not_blank check (btrim(internal_code) <> ''),
  constraint app_maintenance_assets_name_not_blank check (btrim(name) <> ''),
  constraint app_maintenance_assets_status_check check (status in ('ATIVO', 'EM_MANUTENCAO', 'PARADO', 'RESERVA', 'BAIXADO', 'EM_GARANTIA', 'AGUARDANDO_PECA', 'AGUARDANDO_TERCEIRO')),
  constraint app_maintenance_assets_criticality_check check (criticality in ('CRITICA', 'ALTA', 'MEDIA', 'BAIXA')),
  constraint app_maintenance_assets_values_check check (
    (acquisition_value_cents is null or acquisition_value_cents >= 0)
    and (warranty_months is null or warranty_months >= 0)
    and (useful_life_months is null or useful_life_months >= 0)
    and current_meter >= 0
  ),
  constraint app_maintenance_assets_meter_type_check check (meter_type is null or meter_type in ('HOURS', 'KM', 'CYCLES'))
);
create unique index if not exists app_maintenance_assets_internal_code_uidx
  on public.app_maintenance_assets(upper(btrim(internal_code))) where deleted_at is null;
create unique index if not exists app_maintenance_assets_asset_tag_uidx
  on public.app_maintenance_assets(upper(btrim(asset_tag))) where deleted_at is null and asset_tag is not null;
create unique index if not exists app_maintenance_assets_serial_uidx
  on public.app_maintenance_assets(upper(btrim(serial_number))) where deleted_at is null and serial_number is not null;
create unique index if not exists app_maintenance_assets_qr_uidx
  on public.app_maintenance_assets(qr_code) where deleted_at is null and qr_code is not null;
create index if not exists app_maintenance_assets_branch_filter_idx
  on public.app_maintenance_assets(branch_id, status, criticality, category_id, name) where deleted_at is null;
create index if not exists app_maintenance_assets_responsible_idx
  on public.app_maintenance_assets(responsible_user_id) where deleted_at is null;

alter table public.app_maintenance_orders
  drop constraint if exists app_maintenance_orders_asset_id_fkey,
  drop constraint if exists app_maintenance_orders_service_provider_id_fkey;
alter table public.app_maintenance_orders
  add constraint app_maintenance_orders_asset_id_fkey foreign key (asset_id) references public.app_maintenance_assets(id) on delete set null,
  add constraint app_maintenance_orders_service_provider_id_fkey foreign key (service_provider_id) references public.app_maintenance_service_providers(id) on delete set null;
create index if not exists app_maintenance_orders_asset_idx
  on public.app_maintenance_orders(asset_id, created_at desc) where deleted_at is null;
create index if not exists app_maintenance_orders_service_provider_idx
  on public.app_maintenance_orders(service_provider_id) where deleted_at is null;

create table if not exists public.app_maintenance_asset_documents (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.app_maintenance_assets(id) on delete cascade,
  document_type text not null default 'OTHER',
  name text not null,
  bucket text not null,
  path text not null,
  mime_type text,
  size_bytes bigint,
  expires_at date,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_asset_documents_size_check check (size_bytes is null or size_bytes >= 0)
);
create unique index if not exists app_maintenance_asset_documents_path_uidx
  on public.app_maintenance_asset_documents(bucket, path) where deleted_at is null;
create index if not exists app_maintenance_asset_documents_asset_idx
  on public.app_maintenance_asset_documents(asset_id, created_at desc) where deleted_at is null;

create table if not exists public.app_maintenance_asset_events (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.app_maintenance_assets(id) on delete cascade,
  event_type text not null,
  label text not null,
  from_branch_id uuid references public.app_branches(id) on delete set null,
  to_branch_id uuid references public.app_branches(id) on delete set null,
  from_area text,
  to_area text,
  from_responsible_user_id uuid references public.app_user_profiles(id) on delete set null,
  to_responsible_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists app_maintenance_asset_events_asset_idx
  on public.app_maintenance_asset_events(asset_id, created_at desc);

create table if not exists public.app_maintenance_meter_readings (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.app_maintenance_assets(id) on delete cascade,
  meter_type text not null,
  reading numeric(18,3) not null,
  read_at timestamptz not null default now(),
  source text not null default 'MANUAL',
  notes text,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint app_maintenance_meter_readings_type_check check (meter_type in ('HOURS', 'KM', 'CYCLES')),
  constraint app_maintenance_meter_readings_value_check check (reading >= 0),
  constraint app_maintenance_meter_readings_source_check check (source in ('MANUAL', 'IMPORT', 'WORK_ORDER', 'INTEGRATION'))
);
create index if not exists app_maintenance_meter_readings_asset_idx
  on public.app_maintenance_meter_readings(asset_id, meter_type, read_at desc);

create table if not exists public.app_maintenance_user_permissions (
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  action text not null,
  allowed boolean not null default true,
  granted_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, action),
  constraint app_maintenance_user_permissions_action_check check (action in (
    'VIEW', 'CREATE_ORDER', 'EDIT_ORDER', 'CHANGE_STATUS', 'FINISH_ORDER', 'APPROVE_COMPLETION',
    'VIEW_COSTS', 'MANAGE_ASSETS', 'RETIRE_ASSET', 'MANAGE_STOCK', 'MOVE_STOCK', 'ADJUST_STOCK',
    'APPROVE_ADJUSTMENT', 'EXECUTE_INVENTORY', 'APPROVE_INVENTORY', 'MANAGE_PREVENTIVE_PLANS',
    'SYNC_FLUIG', 'VIEW_TECHNICAL_LOGS'
  ))
);

create table if not exists public.app_maintenance_audit_events (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  branch_id uuid references public.app_branches(id) on delete set null,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists app_maintenance_audit_entity_idx
  on public.app_maintenance_audit_events(entity_type, entity_id, created_at desc);
create index if not exists app_maintenance_audit_actor_idx
  on public.app_maintenance_audit_events(actor_user_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_maintenance_asset_categories',
    'app_maintenance_service_providers',
    'app_maintenance_assets',
    'app_maintenance_user_permissions'
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
    'app_maintenance_asset_categories', 'app_maintenance_service_providers', 'app_maintenance_assets',
    'app_maintenance_asset_documents', 'app_maintenance_asset_events', 'app_maintenance_meter_readings',
    'app_maintenance_user_permissions', 'app_maintenance_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_all', table_name);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_all', table_name);
  end loop;
end $$;

revoke all on sequence public.app_maintenance_order_number_seq from anon, authenticated;
grant usage, select on sequence public.app_maintenance_order_number_seq to service_role;
