create or replace function public.app_maintenance_report_summary(
  p_branch_ids uuid[] default null,
  p_from timestamptz default date_trunc('month', now()),
  p_to timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with scoped_orders as (
  select orders.*
  from public.app_maintenance_orders orders
  where orders.deleted_at is null
    and (p_branch_ids is null or orders.branch_id = any(p_branch_ids))
), period_orders as (
  select * from scoped_orders where created_at >= p_from and created_at <= p_to
), scoped_assets as (
  select assets.*
  from public.app_maintenance_assets assets
  where assets.deleted_at is null
    and (p_branch_ids is null or assets.branch_id = any(p_branch_ids))
), scoped_locations as (
  select locations.id
  from public.app_maintenance_storage_locations locations
  join public.app_maintenance_warehouses warehouses on warehouses.id = locations.warehouse_id
  where locations.deleted_at is null and warehouses.deleted_at is null
    and (p_branch_ids is null or warehouses.branch_id = any(p_branch_ids))
), stock_by_material as (
  select balances.material_id,
         sum(balances.quantity_on_hand) as on_hand,
         sum(balances.quantity_reserved + balances.quantity_blocked) as unavailable,
         sum(round(balances.quantity_on_hand * coalesce(nullif(balances.average_cost_cents,0), nullif(materials.average_cost_cents,0), materials.last_cost_cents)))::bigint as value_cents,
         max(materials.reorder_point) as reorder_point,
         max(materials.minimum_stock) as minimum_stock
  from public.app_maintenance_stock_balances balances
  join scoped_locations locations on locations.id = balances.location_id
  join public.app_maintenance_materials materials on materials.id = balances.material_id and materials.deleted_at is null and materials.active
  group by balances.material_id
), period_movements as (
  select distinct movements.*
  from public.app_maintenance_stock_movements movements
  left join scoped_locations source on source.id = movements.from_location_id
  left join scoped_locations destination on destination.id = movements.to_location_id
  where movements.occurred_at >= p_from and movements.occurred_at <= p_to
    and (p_branch_ids is null or source.id is not null or destination.id is not null)
), by_status as (
  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', amount) order by status), '[]'::jsonb) value
  from (select status, count(*) amount from scoped_orders group by status) grouped
), by_branch as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'branchId', branch_id, 'branchCode', branch_code, 'branchLabel', branch_label,
    'orders', amount, 'open', open_amount, 'totalCostCents', total_cost
  ) order by branch_code nulls last), '[]'::jsonb) value
  from (
    select branch_id, max(branch_code) branch_code, max(branch_label) branch_label, count(*) amount,
           count(*) filter (where status not in ('FINALIZADA','CANCELADA')) open_amount,
           coalesce(sum(total_cost_cents),0)::bigint total_cost
    from period_orders group by branch_id
  ) grouped
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'orders', jsonb_build_object(
    'created', (select count(*) from period_orders),
    'open', (select count(*) from scoped_orders where status not in ('FINALIZADA','CANCELADA')),
    'finished', (select count(*) from period_orders where status='FINALIZADA'),
    'cancelled', (select count(*) from period_orders where status='CANCELADA'),
    'overdue', (select count(*) from scoped_orders where status not in ('FINALIZADA','CANCELADA') and due_at < now()),
    'totalCostCents', (select coalesce(sum(total_cost_cents),0)::bigint from period_orders),
    'averageDowntimeMinutes', (select coalesce(round(avg(downtime_minutes)),0)::bigint from period_orders where downtime_minutes > 0)
  ),
  'assets', jsonb_build_object(
    'total', (select count(*) from scoped_assets),
    'unavailable', (select count(*) from scoped_assets where status in ('EM_MANUTENCAO','PARADO','AGUARDANDO_PECA','AGUARDANDO_TERCEIRO')),
    'critical', (select count(*) from scoped_assets where criticality='CRITICA' and status <> 'BAIXADO')
  ),
  'stock', jsonb_build_object(
    'valueCents', (select coalesce(sum(value_cents),0)::bigint from stock_by_material),
    'lowStockMaterials', (select count(*) from stock_by_material where on_hand - unavailable <= greatest(reorder_point, minimum_stock)),
    'materialsWithBalance', (select count(*) from stock_by_material)
  ),
  'movements', jsonb_build_object(
    'total', (select count(*) from period_movements),
    'inbound', (select count(*) from period_movements where movement_type in ('PURCHASE_IN','MANUAL_IN','RETURN_FROM_ORDER','POSITIVE_ADJUSTMENT','INVENTORY_IN','REVERSAL_IN')),
    'outbound', (select count(*) from period_movements where movement_type in ('WORK_ORDER_OUT','NEGATIVE_ADJUSTMENT','LOSS','DAMAGE','INVENTORY_OUT','WRITE_OFF','REVERSAL_OUT'))
  ),
  'preventiveDue', (
    select count(*) from public.app_maintenance_preventive_plans plans
    where plans.deleted_at is null and plans.active and plans.next_due_at <= now()
      and (p_branch_ids is null or plans.branch_id = any(p_branch_ids))
  ),
  'byStatus', (select value from by_status),
  'byBranch', (select value from by_branch)
);
$$;

revoke execute on function public.app_maintenance_report_summary(uuid[],timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.app_maintenance_report_summary(uuid[],timestamptz,timestamptz) to service_role;
