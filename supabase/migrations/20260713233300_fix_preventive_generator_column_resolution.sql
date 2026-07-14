-- Recompile the generator with deterministic PL/pgSQL column resolution.
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

revoke execute on function public.app_maintenance_generate_preventive_orders(timestamptz) from public, anon, authenticated;
grant execute on function public.app_maintenance_generate_preventive_orders(timestamptz) to service_role;
