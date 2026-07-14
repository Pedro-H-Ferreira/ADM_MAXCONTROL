create table if not exists public.app_maintenance_preventive_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text not null,
  branch_id uuid references public.app_branches(id) on delete restrict,
  checklist_template_id uuid references public.app_maintenance_checklist_templates(id) on delete set null,
  recurrence_value numeric(18,3) not null,
  recurrence_unit text not null,
  expected_minutes integer,
  responsible_user_id uuid references public.app_user_profiles(id) on delete set null,
  responsible_name text,
  service_provider_id uuid references public.app_maintenance_service_providers(id) on delete set null,
  priority text not null default 'MEDIA',
  tolerance_before integer not null default 0,
  tolerance_after integer not null default 0,
  auto_generate_order boolean not null default true,
  generation_lead_days integer not null default 0,
  next_due_at timestamptz,
  next_meter_value numeric(18,3),
  notify_before_days integer not null default 7,
  evidence_required boolean not null default false,
  completion_approval_required boolean not null default false,
  active boolean not null default true,
  last_generated_at timestamptz,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_maintenance_preventive_plans_code_not_blank check (btrim(code) <> ''),
  constraint app_maintenance_preventive_plans_name_not_blank check (btrim(name) <> ''),
  constraint app_maintenance_preventive_plans_recurrence_check check (
    recurrence_value > 0 and recurrence_unit in ('DAYS', 'WEEKS', 'MONTHS', 'YEARS', 'HOURS', 'KM', 'CYCLES')
  ),
  constraint app_maintenance_preventive_plans_priority_check check (priority in ('CRITICA', 'ALTA', 'MEDIA', 'BAIXA')),
  constraint app_maintenance_preventive_plans_values_check check (
    (expected_minutes is null or expected_minutes >= 0) and tolerance_before >= 0 and tolerance_after >= 0
    and generation_lead_days >= 0 and notify_before_days >= 0 and (next_meter_value is null or next_meter_value >= 0)
  )
);
create unique index if not exists app_maintenance_preventive_plans_code_uidx
  on public.app_maintenance_preventive_plans(upper(btrim(code))) where deleted_at is null;
create index if not exists app_maintenance_preventive_plans_due_idx
  on public.app_maintenance_preventive_plans(next_due_at, branch_id)
  where deleted_at is null and active and auto_generate_order and recurrence_unit in ('DAYS', 'WEEKS', 'MONTHS', 'YEARS');
create index if not exists app_maintenance_preventive_plans_meter_idx
  on public.app_maintenance_preventive_plans(recurrence_unit, next_meter_value)
  where deleted_at is null and active and auto_generate_order and recurrence_unit in ('HOURS', 'KM', 'CYCLES');

create table if not exists public.app_maintenance_preventive_plan_assets (
  plan_id uuid not null references public.app_maintenance_preventive_plans(id) on delete cascade,
  asset_id uuid not null references public.app_maintenance_assets(id) on delete cascade,
  active boolean not null default true,
  last_executed_at timestamptz,
  next_due_override timestamptz,
  next_meter_override numeric(18,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(plan_id, asset_id),
  constraint app_maintenance_preventive_plan_assets_meter_check check (next_meter_override is null or next_meter_override >= 0)
);
create index if not exists app_maintenance_preventive_plan_assets_asset_idx
  on public.app_maintenance_preventive_plan_assets(asset_id, active);

create table if not exists public.app_maintenance_preventive_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.app_maintenance_preventive_plans(id) on delete cascade,
  position integer not null,
  title text not null,
  description text,
  expected_minutes integer,
  required boolean not null default true,
  evidence_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_maintenance_preventive_plan_tasks_position_uidx unique(plan_id, position),
  constraint app_maintenance_preventive_plan_tasks_minutes_check check (expected_minutes is null or expected_minutes >= 0)
);

create table if not exists public.app_maintenance_preventive_plan_materials (
  plan_id uuid not null references public.app_maintenance_preventive_plans(id) on delete cascade,
  material_id uuid not null references public.app_maintenance_materials(id) on delete restrict,
  planned_quantity numeric(18,3) not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(plan_id, material_id),
  constraint app_maintenance_preventive_plan_materials_quantity_check check (planned_quantity > 0)
);
create index if not exists app_maintenance_preventive_plan_materials_material_idx
  on public.app_maintenance_preventive_plan_materials(material_id, plan_id);

alter table public.app_maintenance_orders
  drop constraint if exists app_maintenance_orders_preventive_plan_id_fkey;
alter table public.app_maintenance_orders
  add constraint app_maintenance_orders_preventive_plan_id_fkey
  foreign key (preventive_plan_id) references public.app_maintenance_preventive_plans(id) on delete set null;
create index if not exists app_maintenance_orders_preventive_plan_idx
  on public.app_maintenance_orders(preventive_plan_id, created_at desc) where preventive_plan_id is not null;

create or replace function public.app_maintenance_generate_preventive_orders(p_now timestamptz default now())
returns table(plan_id uuid, asset_id uuid, order_id uuid, due_key text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  item record;
  generated_order_id uuid;
  item_due_key text;
  effective_due_at timestamptz;
  effective_meter numeric(18,3);
begin
  perform pg_advisory_xact_lock(hashtext('app_maintenance_generate_preventive_orders'));

  for item in
    select
      p.*,
      pa.asset_id as linked_asset_id,
      pa.next_due_override,
      pa.next_meter_override,
      a.name as asset_name,
      a.area as asset_area,
      a.current_meter,
      a.branch_id as asset_branch_id,
      b.code as branch_code,
      coalesce(b.fluig_label, b.name) as branch_label
    from public.app_maintenance_preventive_plans p
    join public.app_maintenance_preventive_plan_assets pa on pa.plan_id = p.id and pa.active
    join public.app_maintenance_assets a on a.id = pa.asset_id and a.deleted_at is null and a.status <> 'BAIXADO'
    join public.app_branches b on b.id = a.branch_id
    where p.deleted_at is null and p.active and p.auto_generate_order
      and (
        (
          p.recurrence_unit in ('DAYS', 'WEEKS', 'MONTHS', 'YEARS')
          and coalesce(pa.next_due_override, p.next_due_at) is not null
          and coalesce(pa.next_due_override, p.next_due_at) <= p_now + make_interval(days => p.generation_lead_days)
        )
        or (
          p.recurrence_unit in ('HOURS', 'KM', 'CYCLES')
          and coalesce(pa.next_meter_override, p.next_meter_value) is not null
          and a.current_meter >= coalesce(pa.next_meter_override, p.next_meter_value)
        )
      )
    order by p.id, pa.asset_id
    for update of p, pa
  loop
    effective_due_at := coalesce(item.next_due_override, item.next_due_at);
    effective_meter := coalesce(item.next_meter_override, item.next_meter_value);
    item_due_key := case
      when item.recurrence_unit in ('DAYS', 'WEEKS', 'MONTHS', 'YEARS')
        then 'DATE:' || to_char(effective_due_at at time zone 'UTC', 'YYYYMMDDHH24MISS')
      else item.recurrence_unit || ':' || effective_meter::text
    end;
    generated_order_id := null;

    insert into public.app_maintenance_orders(
      code, source, work_type, title, description, area, priority, status,
      technician_user_id, technician, branch_id, branch_code, branch_label,
      asset_id, service_provider_id, preventive_plan_id, preventive_due_key,
      due_at, sla_minutes, approval_status, metadata, created_by_user_id, updated_by_user_id
    ) values (
      null, 'preventiva', 'PREVENTIVA', item.name || ' - ' || item.asset_name, item.description,
      coalesce(item.asset_area, 'Manutencao preventiva'), item.priority, 'ABERTA',
      item.responsible_user_id, item.responsible_name, item.asset_branch_id, item.branch_code, item.branch_label,
      item.linked_asset_id, item.service_provider_id, item.id, item_due_key,
      effective_due_at, item.expected_minutes,
      case when item.completion_approval_required then 'PENDING' else 'NOT_REQUIRED' end,
      jsonb_build_object('preventivePlanCode', item.code, 'evidenceRequired', item.evidence_required),
      item.created_by_user_id, item.updated_by_user_id
    )
    on conflict (preventive_plan_id, asset_id, preventive_due_key)
      where preventive_plan_id is not null and asset_id is not null and preventive_due_key is not null
    do nothing
    returning id into generated_order_id;

    if generated_order_id is not null then
      insert into public.app_maintenance_order_materials(order_id, material_id, planned_quantity, created_by_user_id, updated_by_user_id)
      select generated_order_id, material_id, planned_quantity, item.created_by_user_id, item.updated_by_user_id
      from public.app_maintenance_preventive_plan_materials
      where plan_id = item.id
      on conflict (order_id, material_id) do update
      set planned_quantity = excluded.planned_quantity, updated_at = now();

      insert into public.app_maintenance_order_events(order_id, actor_user_id, event_type, event_label, status_to, event_payload)
      values (generated_order_id, item.created_by_user_id, 'PREVENTIVE_GENERATED', 'OS preventiva gerada automaticamente', 'ABERTA', jsonb_build_object('planId', item.id, 'assetId', item.linked_asset_id, 'dueKey', item_due_key));

      update public.app_maintenance_assets
      set next_maintenance_at = effective_due_at, updated_at = now()
      where id = item.linked_asset_id;

      plan_id := item.id;
      asset_id := item.linked_asset_id;
      order_id := generated_order_id;
      due_key := item_due_key;
      return next;
    end if;

    if item.recurrence_unit = 'DAYS' then
      update public.app_maintenance_preventive_plan_assets set next_due_override = greatest(coalesce(next_due_override, item.next_due_at), p_now) + make_interval(days => item.recurrence_value::integer), updated_at = now() where plan_id = item.id and asset_id = item.linked_asset_id;
    elsif item.recurrence_unit = 'WEEKS' then
      update public.app_maintenance_preventive_plan_assets set next_due_override = greatest(coalesce(next_due_override, item.next_due_at), p_now) + make_interval(days => (item.recurrence_value * 7)::integer), updated_at = now() where plan_id = item.id and asset_id = item.linked_asset_id;
    elsif item.recurrence_unit = 'MONTHS' then
      update public.app_maintenance_preventive_plan_assets set next_due_override = greatest(coalesce(next_due_override, item.next_due_at), p_now) + make_interval(months => item.recurrence_value::integer), updated_at = now() where plan_id = item.id and asset_id = item.linked_asset_id;
    elsif item.recurrence_unit = 'YEARS' then
      update public.app_maintenance_preventive_plan_assets set next_due_override = greatest(coalesce(next_due_override, item.next_due_at), p_now) + make_interval(years => item.recurrence_value::integer), updated_at = now() where plan_id = item.id and asset_id = item.linked_asset_id;
    else
      update public.app_maintenance_preventive_plan_assets set next_meter_override = greatest(coalesce(next_meter_override, item.next_meter_value), item.current_meter) + item.recurrence_value, updated_at = now() where plan_id = item.id and asset_id = item.linked_asset_id;
    end if;
    update public.app_maintenance_preventive_plans set last_generated_at = p_now, updated_at = now() where id = item.id;
  end loop;
end;
$$;

-- Every active branch starts with a controlled default warehouse and location.
insert into public.app_maintenance_warehouses(branch_id, code, name)
select id, 'MANUT', 'Almoxarifado de manutencao'
from public.app_branches b
where b.active
  and not exists (
    select 1 from public.app_maintenance_warehouses w
    where w.branch_id = b.id and upper(btrim(w.code)) = 'MANUT' and w.deleted_at is null
  );

insert into public.app_maintenance_storage_locations(warehouse_id, code, description)
select w.id, 'GERAL', 'Posicao geral de manutencao'
from public.app_maintenance_warehouses w
where w.deleted_at is null
  and not exists (
    select 1 from public.app_maintenance_storage_locations l
    where l.warehouse_id = w.id and upper(btrim(l.code)) = 'GERAL' and l.deleted_at is null
  );

-- Gradual compatibility: retain JSONB while material and attachment rows are backfilled.
with legacy_materials as (
  select distinct
    'LEGACY-' || upper(substr(md5(lower(btrim(item.value->>'item'))), 1, 16)) as code,
    btrim(item.value->>'item') as name
  from public.app_maintenance_orders o
  cross join lateral jsonb_array_elements(coalesce(o.materials, '[]'::jsonb)) item(value)
  where nullif(btrim(item.value->>'item'), '') is not null
)
insert into public.app_maintenance_materials(code, name, unit, active, metadata)
select code, name, 'UN', true, jsonb_build_object('legacyBackfill', true, 'requiresReview', true)
from legacy_materials lm
where not exists (
  select 1 from public.app_maintenance_materials m where upper(btrim(m.code)) = upper(btrim(lm.code)) and m.deleted_at is null
);

with legacy_order_materials as (
  select
    o.id as order_id,
    m.id as material_id,
    item.value,
    item.ordinality
  from public.app_maintenance_orders o
  cross join lateral jsonb_array_elements(coalesce(o.materials, '[]'::jsonb)) with ordinality item(value, ordinality)
  join public.app_maintenance_materials m
    on upper(btrim(m.code)) = 'LEGACY-' || upper(substr(md5(lower(btrim(item.value->>'item'))), 1, 16))
  where nullif(btrim(item.value->>'item'), '') is not null
)
insert into public.app_maintenance_order_materials(order_id, material_id, planned_quantity, consumed_quantity, unit_cost_cents, notes)
select
  order_id,
  material_id,
  1,
  case when coalesce((value->>'valueCents')::bigint, 0) > 0 then 1 else 0 end,
  greatest(coalesce((value->>'valueCents')::bigint, 0), 0),
  concat_ws(' | ', 'Migrado do JSON legado', nullif(value->>'quantity', ''))
from legacy_order_materials
on conflict (order_id, material_id) do nothing;

with legacy_photos as (
  select
    o.id as order_id,
    photo.value,
    photo.ordinality,
    md5(o.id::text || ':' || photo.ordinality::text || ':' || coalesce(photo.value->>'name', 'foto')) as legacy_key
  from public.app_maintenance_orders o
  cross join lateral jsonb_array_elements(coalesce(o.photos, '[]'::jsonb)) with ordinality photo(value, ordinality)
)
insert into public.app_maintenance_order_attachments(
  order_id, attachment_type, name, bucket, path, mime_type, size_bytes, legacy_key, uploaded_by_user_id, created_at
)
select
  order_id,
  'OTHER',
  coalesce(nullif(value->>'name', ''), 'foto'),
  nullif(value->>'bucket', ''),
  nullif(value->>'path', ''),
  nullif(value->>'type', ''),
  case when coalesce(value->>'size', '') ~ '^\d+$' then (value->>'size')::bigint else null end,
  legacy_key,
  case when coalesce(value->>'uploadedByUserId', '') ~ '^[0-9a-fA-F-]{36}$' then (value->>'uploadedByUserId')::uuid else null end,
  case when coalesce(value->>'uploadedAt', '') ~ '^\d{4}-\d{2}-\d{2}' then (value->>'uploadedAt')::timestamptz else now() end
from legacy_photos
on conflict (order_id, legacy_key) where legacy_key is not null do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_maintenance_preventive_plans', 'app_maintenance_preventive_plan_assets',
    'app_maintenance_preventive_plan_tasks', 'app_maintenance_preventive_plan_materials'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'set_' || table_name || '_updated_at', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_all', table_name);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_all', table_name);
  end loop;
end $$;

revoke execute on function public.app_maintenance_generate_preventive_orders(timestamptz) from public, anon, authenticated;
grant execute on function public.app_maintenance_generate_preventive_orders(timestamptz) to service_role;
