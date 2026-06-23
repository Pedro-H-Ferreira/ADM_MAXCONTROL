create table if not exists public.app_maintenance_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  source text not null default 'manual' check (source in ('manual', 'fluig')),
  title text not null,
  description text not null,
  area text not null,
  priority text not null default 'MEDIA' check (priority in ('CRITICA', 'ALTA', 'MEDIA', 'BAIXA')),
  status text not null default 'ABERTA' check (
    status in ('ABERTA', 'INICIADA', 'AGUARDANDO_MATERIAL', 'AGUARDANDO_TERCEIRO', 'FINALIZADA', 'CANCELADA')
  ),
  requester text,
  requester_user_id uuid references public.app_user_profiles(id) on delete set null,
  technician text,
  technician_user_id uuid references public.app_user_profiles(id) on delete set null,
  branch_id uuid references public.app_branches(id) on delete set null,
  branch_code text,
  branch_label text,
  due_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  material_summary text,
  material_cost_cents integer not null default 0 check (material_cost_cents >= 0),
  materials jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  pending_reason text,
  fluig_request_id text,
  fluig_request_row_id uuid references public.fluig_requests(id) on delete set null,
  fluig_num_lanc_w text,
  fluig_current_task text,
  fluig_task_owner text,
  fluig_last_sync_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.app_maintenance_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.app_maintenance_orders(id) on delete cascade,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null,
  event_label text,
  status_from text,
  status_to text,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

drop trigger if exists set_app_maintenance_orders_updated_at on public.app_maintenance_orders;
create trigger set_app_maintenance_orders_updated_at
  before update on public.app_maintenance_orders
  for each row execute function public.set_updated_at();

create index if not exists app_maintenance_orders_status_idx
  on public.app_maintenance_orders (status, priority, due_at);
create index if not exists app_maintenance_orders_branch_idx
  on public.app_maintenance_orders (branch_id, branch_code);
create index if not exists app_maintenance_orders_source_idx
  on public.app_maintenance_orders (source, created_at desc);
create index if not exists app_maintenance_orders_fluig_request_idx
  on public.app_maintenance_orders (fluig_request_id) where fluig_request_id is not null;
create index if not exists app_maintenance_orders_technician_idx
  on public.app_maintenance_orders (technician_user_id, status);
create index if not exists app_maintenance_order_events_order_idx
  on public.app_maintenance_order_events (order_id, created_at desc);

alter table public.app_maintenance_orders enable row level security;
alter table public.app_maintenance_order_events enable row level security;

revoke all on public.app_maintenance_orders from anon, authenticated;
revoke all on public.app_maintenance_order_events from anon, authenticated;
grant select, insert, update, delete on public.app_maintenance_orders to service_role;
grant select, insert, update, delete on public.app_maintenance_order_events to service_role;
