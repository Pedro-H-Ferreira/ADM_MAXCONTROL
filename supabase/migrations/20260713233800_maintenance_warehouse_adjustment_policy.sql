alter table public.app_maintenance_warehouses
  add column if not exists require_approval_for_adjustment boolean not null default true;

comment on column public.app_maintenance_warehouses.require_approval_for_adjustment is
  'Requires an authorized approval before inventory or manual adjustments are applied.';
