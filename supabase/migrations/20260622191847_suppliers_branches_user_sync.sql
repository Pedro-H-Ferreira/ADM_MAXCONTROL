create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.app_branches
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists uf text,
  add column if not exists last_fluig_sync_at timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists public.app_suppliers (
  id uuid primary key default gen_random_uuid(),
  cnpj text,
  cnpj_normalizado text,
  razao_social text not null,
  nome_fantasia text,
  inscricao_estadual text,
  inscricao_municipal text,
  categoria text,
  status text not null default 'ATIVO' check (status in ('ATIVO', 'PENDENTE_REVISAO', 'INATIVO')),
  email text,
  telefone text,
  contato_principal text,
  contatos jsonb not null default '[]'::jsonb,
  cep text,
  endereco text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  pais text not null default 'BR',
  observacoes text,
  fluig_name text,
  fluig_code text,
  fluig_supplier_label text,
  default_source_request_id text,
  default_payload jsonb not null default '{}'::jsonb,
  source_system text not null default 'LOCAL' check (
    source_system in ('LOCAL', 'FLUIG', 'LOCAL_FLUIG', 'PRE_CADASTRO_FLUIG')
  ),
  sync_status text not null default 'NAO_SINCRONIZADO' check (
    sync_status in ('NAO_SINCRONIZADO', 'SINCRONIZADO', 'PENDENTE_REVISAO', 'ERRO_SYNC')
  ),
  last_fluig_sync_at timestamptz,
  created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_suppliers_cnpj_normalized_digits
    check (cnpj_normalizado is null or cnpj_normalizado ~ '^[0-9]{14}$')
);

create unique index if not exists app_suppliers_cnpj_normalizado_unique
  on public.app_suppliers (cnpj_normalizado)
  where cnpj_normalizado is not null and deleted_at is null;

create index if not exists app_suppliers_razao_social_idx
  on public.app_suppliers using gin (to_tsvector('portuguese', coalesce(razao_social, '') || ' ' || coalesce(nome_fantasia, '')));
create index if not exists app_suppliers_fluig_code_idx on public.app_suppliers (fluig_code);
create index if not exists app_suppliers_status_idx on public.app_suppliers (status);
create index if not exists app_suppliers_sync_status_idx on public.app_suppliers (sync_status);
create index if not exists app_suppliers_deleted_at_idx on public.app_suppliers (deleted_at);

drop trigger if exists set_app_suppliers_updated_at on public.app_suppliers;
create trigger set_app_suppliers_updated_at
  before update on public.app_suppliers
  for each row execute function public.set_updated_at();

create table if not exists public.app_supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.app_suppliers(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role text,
  primary_contact boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_supplier_contacts_supplier_id_idx
  on public.app_supplier_contacts (supplier_id);

drop trigger if exists set_app_supplier_contacts_updated_at on public.app_supplier_contacts;
create trigger set_app_supplier_contacts_updated_at
  before update on public.app_supplier_contacts
  for each row execute function public.set_updated_at();

create table if not exists public.app_supplier_branch_links (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.app_suppliers(id) on delete cascade,
  branch_id uuid not null references public.app_branches(id) on delete cascade,
  default_branch boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (supplier_id, branch_id)
);

create index if not exists app_supplier_branch_links_supplier_id_idx
  on public.app_supplier_branch_links (supplier_id);
create index if not exists app_supplier_branch_links_branch_id_idx
  on public.app_supplier_branch_links (branch_id);

create table if not exists public.app_supplier_audit_events (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.app_suppliers(id) on delete set null,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null,
  before_payload jsonb,
  after_payload jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_supplier_audit_events_supplier_id_idx
  on public.app_supplier_audit_events (supplier_id, created_at desc);

create table if not exists public.fluig_user_sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  fluig_username text,
  fluig_user_id text,
  module_slug text not null check (module_slug in ('pagamentos', 'compras', 'manutencao', 'fornecedores')),
  sync_type text not null check (
    sync_type in ('historical', 'open_tasks', 'my_requests', 'status_check', 'supplier_lookup')
  ),
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  cursor jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, module_slug, sync_type)
);

create index if not exists fluig_user_sync_state_user_type_idx
  on public.fluig_user_sync_state (user_id, sync_type, module_slug);

drop trigger if exists set_fluig_user_sync_state_updated_at on public.fluig_user_sync_state;
create trigger set_fluig_user_sync_state_updated_at
  before update on public.fluig_user_sync_state
  for each row execute function public.set_updated_at();

alter table public.fluig_requests
  add column if not exists app_supplier_id uuid references public.app_suppliers(id) on delete set null,
  add column if not exists finalized_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists normalized_status text,
  add column if not exists is_open boolean,
  add column if not exists last_status_check_at timestamptz,
  add column if not exists last_seen_in_user_open_list_at timestamptz,
  add column if not exists sync_source text,
  add column if not exists sync_owner_user_id uuid references public.app_user_profiles(id) on delete set null;

create index if not exists fluig_requests_app_supplier_id_idx on public.fluig_requests (app_supplier_id);
create index if not exists fluig_requests_is_open_idx on public.fluig_requests (is_open) where is_open is true;
create index if not exists fluig_requests_sync_owner_user_id_idx on public.fluig_requests (sync_owner_user_id);

alter table public.fluig_supplier_links
  add column if not exists app_supplier_id uuid references public.app_suppliers(id) on delete set null;

create index if not exists fluig_supplier_links_app_supplier_id_idx
  on public.fluig_supplier_links (app_supplier_id);

create unique index if not exists fluig_supplier_links_candidate_id_unique
  on public.fluig_supplier_links (candidate_id)
  where candidate_id is not null;

alter table public.fluig_jobs
  drop constraint if exists fluig_jobs_operation_check;

alter table public.fluig_jobs
  add constraint fluig_jobs_operation_check
  check (
    operation in (
      'sync_history',
      'sync_status',
      'open_from_source',
      'cancel_request',
      'health_check',
      'sync_initial_history',
      'sync_user_open_tasks',
      'sync_user_open_requests',
      'sync_request_by_number',
      'supplier_lookup_by_cnpj'
    )
  );

alter table public.app_suppliers enable row level security;
alter table public.app_supplier_contacts enable row level security;
alter table public.app_supplier_branch_links enable row level security;
alter table public.app_supplier_audit_events enable row level security;
alter table public.fluig_user_sync_state enable row level security;

drop policy if exists "authenticated_read_app_suppliers" on public.app_suppliers;
create policy "authenticated_read_app_suppliers"
  on public.app_suppliers for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and profile.role in ('ADMIN_MASTER', 'ADMIN')
    )
    or (
      deleted_at is null
      and (
        not exists (
          select 1
          from public.app_supplier_branch_links supplier_branch
          where supplier_branch.supplier_id = app_suppliers.id
        )
        or exists (
          select 1
          from public.app_supplier_branch_links supplier_branch
          join public.app_user_branch_access access on access.branch_id = supplier_branch.branch_id
          join public.app_user_profiles profile on profile.id = access.user_id
          where supplier_branch.supplier_id = app_suppliers.id
            and access.can_view = true
            and profile.auth_user_id = (select auth.uid())
            and profile.active = true
            and profile.approval_status = 'APPROVED'
        )
      )
    )
  );

drop policy if exists "authenticated_read_app_supplier_contacts" on public.app_supplier_contacts;
create policy "authenticated_read_app_supplier_contacts"
  on public.app_supplier_contacts for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_suppliers supplier
      where supplier.id = app_supplier_contacts.supplier_id
    )
  );

drop policy if exists "authenticated_read_app_supplier_branch_links" on public.app_supplier_branch_links;
create policy "authenticated_read_app_supplier_branch_links"
  on public.app_supplier_branch_links for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_suppliers supplier
      where supplier.id = app_supplier_branch_links.supplier_id
    )
  );

drop policy if exists "admin_read_app_supplier_audit_events" on public.app_supplier_audit_events;
create policy "admin_read_app_supplier_audit_events"
  on public.app_supplier_audit_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and profile.role in ('ADMIN_MASTER', 'ADMIN')
    )
  );

drop policy if exists "authenticated_read_fluig_user_sync_state" on public.fluig_user_sync_state;
create policy "authenticated_read_fluig_user_sync_state"
  on public.fluig_user_sync_state for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and (
          profile.role in ('ADMIN_MASTER', 'ADMIN')
          or profile.id = fluig_user_sync_state.user_id
        )
    )
  );

grant select on public.app_suppliers to authenticated;
grant select on public.app_supplier_contacts to authenticated;
grant select on public.app_supplier_branch_links to authenticated;
grant select on public.app_supplier_audit_events to authenticated;
grant select on public.fluig_user_sync_state to authenticated;

revoke insert, update, delete on public.app_suppliers from authenticated;
revoke insert, update, delete on public.app_supplier_contacts from authenticated;
revoke insert, update, delete on public.app_supplier_branch_links from authenticated;
revoke insert, update, delete on public.app_supplier_audit_events from authenticated;
revoke insert, update, delete on public.fluig_user_sync_state from authenticated;
