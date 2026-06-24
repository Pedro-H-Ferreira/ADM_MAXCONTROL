create table if not exists public.app_fluig_launches (
  id uuid primary key default gen_random_uuid(),
  module_slug text not null check (module_slug in ('pagamentos', 'compras')),
  status text not null default 'VALIDADO' check (
    status in ('VALIDADO', 'NA_FILA', 'EM_EXECUCAO', 'ABERTO_NO_FLUIG', 'ERRO', 'CANCELADO')
  ),
  title text not null,
  description text,
  app_supplier_id uuid references public.app_suppliers(id) on delete set null,
  supplier_name text,
  supplier_cnpj text,
  branch_id uuid references public.app_branches(id) on delete set null,
  branch_code text,
  branch_label text,
  source_request_id text not null,
  fluig_job_id uuid references public.fluig_jobs(id) on delete set null,
  fluig_request_id text,
  fluig_request_row_id uuid references public.fluig_requests(id) on delete set null,
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  due_date date,
  field_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(field_overrides) = 'object'),
  attachment_metadata jsonb not null default '[]'::jsonb check (jsonb_typeof(attachment_metadata) = 'array'),
  review_fingerprint text not null,
  progress_stage text,
  progress_label text,
  last_error_message text,
  result_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(result_payload) = 'object'),
  validated_at timestamptz not null default now(),
  queued_at timestamptz,
  opened_at timestamptz,
  failed_at timestamptz,
  created_by_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.app_fluig_launch_items (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.app_fluig_launches(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null,
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (launch_id, line_number)
);

create table if not exists public.app_fluig_launch_events (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.app_fluig_launches(id) on delete cascade,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null,
  event_label text,
  status_from text,
  status_to text,
  event_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(event_payload) = 'object'),
  created_at timestamptz not null default now()
);

drop trigger if exists set_app_fluig_launches_updated_at on public.app_fluig_launches;
create trigger set_app_fluig_launches_updated_at
  before update on public.app_fluig_launches
  for each row execute function public.set_updated_at();

create unique index if not exists app_fluig_launches_job_uidx
  on public.app_fluig_launches (fluig_job_id)
  where fluig_job_id is not null;
create unique index if not exists app_fluig_launches_request_uidx
  on public.app_fluig_launches (module_slug, fluig_request_id)
  where fluig_request_id is not null;
create index if not exists app_fluig_launches_module_status_idx
  on public.app_fluig_launches (module_slug, status, created_at desc);
create index if not exists app_fluig_launches_creator_idx
  on public.app_fluig_launches (created_by_user_id, created_at desc);
create index if not exists app_fluig_launches_branch_idx
  on public.app_fluig_launches (branch_id, branch_code, created_at desc);
create index if not exists app_fluig_launches_supplier_idx
  on public.app_fluig_launches (app_supplier_id, created_at desc);
create index if not exists app_fluig_launches_fluig_request_row_idx
  on public.app_fluig_launches (fluig_request_row_id);
create index if not exists app_fluig_launch_items_launch_idx
  on public.app_fluig_launch_items (launch_id, line_number);
create index if not exists app_fluig_launch_events_launch_idx
  on public.app_fluig_launch_events (launch_id, created_at desc);
create index if not exists app_fluig_launch_events_actor_idx
  on public.app_fluig_launch_events (actor_user_id, created_at desc);

alter table public.app_fluig_launches enable row level security;
alter table public.app_fluig_launch_items enable row level security;
alter table public.app_fluig_launch_events enable row level security;

revoke all on public.app_fluig_launches from anon, authenticated;
revoke all on public.app_fluig_launch_items from anon, authenticated;
revoke all on public.app_fluig_launch_events from anon, authenticated;

grant select, insert, update, delete on public.app_fluig_launches to service_role;
grant select, insert, update, delete on public.app_fluig_launch_items to service_role;
grant select, insert, update, delete on public.app_fluig_launch_events to service_role;

drop policy if exists app_fluig_launches_service_role_all on public.app_fluig_launches;
create policy app_fluig_launches_service_role_all
  on public.app_fluig_launches
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists app_fluig_launch_items_service_role_all on public.app_fluig_launch_items;
create policy app_fluig_launch_items_service_role_all
  on public.app_fluig_launch_items
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists app_fluig_launch_events_service_role_all on public.app_fluig_launch_events;
create policy app_fluig_launch_events_service_role_all
  on public.app_fluig_launch_events
  for all
  to service_role
  using (true)
  with check (true);
