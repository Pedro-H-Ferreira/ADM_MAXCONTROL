create extension if not exists "pgcrypto";

create table if not exists public.fluig_process_mappings (
  id uuid primary key default gen_random_uuid(),
  module_slug text not null unique check (module_slug in ('pagamentos', 'compras', 'manutencao', 'fornecedores')),
  route text not null,
  process_id text not null,
  process_label text not null,
  open_url text,
  status text not null default 'MAPEADO',
  capabilities jsonb not null default '[]'::jsonb,
  mapped_fields jsonb not null default '[]'::jsonb,
  export_files text[] not null default '{}',
  examples jsonb not null default '[]'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fluig_requests (
  id uuid primary key default gen_random_uuid(),
  module_slug text not null check (module_slug in ('pagamentos', 'compras', 'manutencao', 'fornecedores')),
  adm_reference text,
  process_id text,
  fluig_request_id text,
  source_request_id text,
  status text,
  current_task text,
  task_owner text,
  requester text,
  supplier_name text,
  supplier_cnpj text,
  amount_cents integer,
  currency text not null default 'BRL',
  due_date date,
  opened_at timestamptz,
  last_synced_at timestamptz,
  canceled_at timestamptz,
  source_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fluig_requests_module_request_unique unique (module_slug, fluig_request_id)
);

create table if not exists public.fluig_request_events (
  id uuid primary key default gen_random_uuid(),
  fluig_request_id uuid references public.fluig_requests(id) on delete cascade,
  module_slug text check (module_slug in ('pagamentos', 'compras', 'manutencao', 'fornecedores')),
  event_type text not null,
  event_label text,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.fluig_operation_runs (
  id uuid primary key default gen_random_uuid(),
  module_slug text check (module_slug in ('pagamentos', 'compras', 'manutencao', 'fornecedores')),
  operation text not null,
  status text not null check (status in ('dry_run', 'success', 'error')),
  source_mode text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.fluig_supplier_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null unique,
  supplier_name text not null,
  normalized_name text not null,
  cnpj text,
  fluig_name text,
  fluig_code text,
  confidence numeric(5, 2) not null default 0,
  source_request_ids text[] not null default '{}',
  suggested_defaults jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  status text not null default 'PRE_CADASTRO' check (status in ('PRE_CADASTRO', 'EM_REVISAO', 'APROVADO', 'IGNORADO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fluig_supplier_links (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.fluig_supplier_candidates(id) on delete set null,
  adm_supplier_id uuid,
  supplier_name text not null,
  cnpj text,
  fluig_name text,
  fluig_code text,
  default_source_request_id text,
  default_payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fluig_requests_module_status_idx on public.fluig_requests (module_slug, status);
create index if not exists fluig_requests_fluig_request_id_idx on public.fluig_requests (fluig_request_id);
create index if not exists fluig_requests_supplier_cnpj_idx on public.fluig_requests (supplier_cnpj);
create index if not exists fluig_requests_last_synced_at_idx on public.fluig_requests (last_synced_at desc);
create index if not exists fluig_operation_runs_module_operation_idx on public.fluig_operation_runs (module_slug, operation, created_at desc);
create index if not exists fluig_supplier_candidates_cnpj_idx on public.fluig_supplier_candidates (cnpj);
create index if not exists fluig_supplier_links_cnpj_idx on public.fluig_supplier_links (cnpj);

alter table public.fluig_process_mappings enable row level security;
alter table public.fluig_requests enable row level security;
alter table public.fluig_request_events enable row level security;
alter table public.fluig_operation_runs enable row level security;
alter table public.fluig_supplier_candidates enable row level security;
alter table public.fluig_supplier_links enable row level security;

drop policy if exists "authenticated_read_fluig_process_mappings" on public.fluig_process_mappings;
create policy "authenticated_read_fluig_process_mappings"
  on public.fluig_process_mappings for select
  to authenticated
  using (true);

drop policy if exists "authenticated_write_fluig_process_mappings" on public.fluig_process_mappings;
create policy "authenticated_write_fluig_process_mappings"
  on public.fluig_process_mappings for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_fluig_requests" on public.fluig_requests;
create policy "authenticated_all_fluig_requests"
  on public.fluig_requests for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_fluig_request_events" on public.fluig_request_events;
create policy "authenticated_all_fluig_request_events"
  on public.fluig_request_events for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_fluig_operation_runs" on public.fluig_operation_runs;
create policy "authenticated_all_fluig_operation_runs"
  on public.fluig_operation_runs for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_fluig_supplier_candidates" on public.fluig_supplier_candidates;
create policy "authenticated_all_fluig_supplier_candidates"
  on public.fluig_supplier_candidates for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_fluig_supplier_links" on public.fluig_supplier_links;
create policy "authenticated_all_fluig_supplier_links"
  on public.fluig_supplier_links for all
  to authenticated
  using (true)
  with check (true);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.fluig_process_mappings to authenticated;
grant select, insert, update, delete on public.fluig_requests to authenticated;
grant select, insert, update, delete on public.fluig_request_events to authenticated;
grant select, insert, update, delete on public.fluig_operation_runs to authenticated;
grant select, insert, update, delete on public.fluig_supplier_candidates to authenticated;
grant select, insert, update, delete on public.fluig_supplier_links to authenticated;
