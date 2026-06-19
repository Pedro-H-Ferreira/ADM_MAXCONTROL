create extension if not exists "unaccent";

alter table public.app_user_profiles
  drop constraint if exists app_user_profiles_role_check;

alter table public.app_user_profiles
  add constraint app_user_profiles_role_check
  check (
    role in (
      'ADMIN_MASTER',
      'ADMIN',
      'ADMINISTRATIVO',
      'GERENTE_CD',
      'FINANCEIRO',
      'COMPRAS',
      'MANUTENCAO',
      'LEITURA'
    )
  );

create table if not exists public.app_user_page_access (
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  page_slug text not null,
  can_view boolean not null default true,
  can_create boolean not null default false,
  can_update boolean not null default false,
  can_approve boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, page_slug)
);

create table if not exists public.fluig_catalog_items (
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null unique,
  catalog_type text not null check (
    catalog_type in ('supplier', 'branch', 'natureza', 'cost_center', 'payment_method', 'account')
  ),
  module_slug text check (module_slug in ('pagamentos', 'compras', 'manutencao', 'fornecedores')),
  code text,
  label text not null,
  value text not null,
  normalized_label text not null,
  occurrence_count integer not null default 1,
  source_request_id text,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_user_page_access (user_id, page_slug, can_view, can_create, can_update, can_approve)
select profile.id, page.page_slug, true, false, false, false
from public.app_user_profiles profile
cross join lateral (
  select unnest(
    case profile.role
      when 'ADMINISTRATIVO' then array[
        'dashboard',
        'despesas',
        'pagamentos',
        'contratos',
        'fornecedores',
        'produtos',
        'compras',
        'cotacoes',
        'manutencao',
        'tarefas',
        'checklists',
        'notificacoes',
        'relatorios'
      ]
      when 'GERENTE_CD' then array[
        'dashboard',
        'despesas',
        'pagamentos',
        'contratos',
        'fornecedores',
        'produtos',
        'compras',
        'cotacoes',
        'manutencao',
        'tarefas',
        'checklists',
        'notificacoes',
        'relatorios',
        'auditoria',
        'configuracoes'
      ]
      when 'FINANCEIRO' then array[
        'dashboard',
        'despesas',
        'pagamentos',
        'contratos',
        'notificacoes',
        'relatorios'
      ]
      when 'COMPRAS' then array[
        'dashboard',
        'fornecedores',
        'produtos',
        'compras',
        'cotacoes',
        'notificacoes'
      ]
      when 'MANUTENCAO' then array[
        'dashboard',
        'manutencao',
        'tarefas',
        'checklists',
        'notificacoes'
      ]
      when 'LEITURA' then array[
        'dashboard',
        'tarefas',
        'checklists',
        'notificacoes'
      ]
      else array[
        'dashboard',
        'despesas',
        'pagamentos',
        'contratos',
        'fornecedores',
        'produtos',
        'compras',
        'cotacoes',
        'manutencao',
        'tarefas',
        'checklists',
        'usuarios',
        'notificacoes',
        'relatorios',
        'auditoria',
        'configuracoes'
      ]
    end
  ) as page_slug
) page
on conflict (user_id, page_slug) do nothing;

insert into public.fluig_catalog_items (
  catalog_key,
  catalog_type,
  module_slug,
  code,
  label,
  value,
  normalized_label,
  occurrence_count,
  source_request_id,
  metadata,
  last_seen_at
)
select
  concat_ws(
    ':',
    'branch',
    '*',
    coalesce(nullif(branch_code, ''), '*'),
    upper(regexp_replace(unaccent(coalesce(branch_label, branch_code, '')), '[^a-zA-Z0-9]+', ' ', 'g'))
  ) as catalog_key,
  'branch',
  null,
  nullif(branch_code, ''),
  coalesce(nullif(branch_label, ''), nullif(branch_code, '')),
  coalesce(nullif(branch_label, ''), nullif(branch_code, '')),
  upper(regexp_replace(unaccent(coalesce(branch_label, branch_code, '')), '[^a-zA-Z0-9]+', ' ', 'g')),
  count(*)::integer,
  max(fluig_request_id),
  jsonb_build_object('source', 'fluig_requests_seed', 'branchCode', nullif(branch_code, '')),
  max(coalesce(last_synced_at, opened_at, created_at))
from public.fluig_requests
where coalesce(nullif(branch_label, ''), nullif(branch_code, '')) is not null
group by branch_code, branch_label
on conflict (catalog_key) do update
set occurrence_count = excluded.occurrence_count,
    source_request_id = excluded.source_request_id,
    last_seen_at = excluded.last_seen_at,
    updated_at = now();

insert into public.fluig_catalog_items (
  catalog_key,
  catalog_type,
  module_slug,
  code,
  label,
  value,
  normalized_label,
  occurrence_count,
  source_request_id,
  metadata,
  last_seen_at
)
select
  concat_ws(
    ':',
    'supplier',
    '*',
    coalesce(nullif(supplier_cnpj, ''), '*'),
    upper(regexp_replace(unaccent(coalesce(supplier_name, '')), '[^a-zA-Z0-9]+', ' ', 'g'))
  ) as catalog_key,
  'supplier',
  null,
  nullif(supplier_cnpj, ''),
  supplier_name,
  supplier_name,
  upper(regexp_replace(unaccent(supplier_name), '[^a-zA-Z0-9]+', ' ', 'g')),
  count(*)::integer,
  max(fluig_request_id),
  jsonb_build_object('source', 'fluig_requests_seed', 'cnpj', nullif(supplier_cnpj, '')),
  max(coalesce(last_synced_at, opened_at, created_at))
from public.fluig_requests
where nullif(supplier_name, '') is not null
group by supplier_cnpj, supplier_name
on conflict (catalog_key) do update
set occurrence_count = excluded.occurrence_count,
    source_request_id = excluded.source_request_id,
    last_seen_at = excluded.last_seen_at,
    updated_at = now();

create index if not exists app_user_page_access_page_idx on public.app_user_page_access (page_slug);
create index if not exists fluig_catalog_items_type_module_idx on public.fluig_catalog_items (catalog_type, module_slug);
create index if not exists fluig_catalog_items_code_idx on public.fluig_catalog_items (code);
create index if not exists fluig_catalog_items_last_seen_idx on public.fluig_catalog_items (last_seen_at desc);

alter table public.app_user_page_access enable row level security;
alter table public.fluig_catalog_items enable row level security;

drop policy if exists "authenticated_read_app_user_page_access" on public.app_user_page_access;
create policy "authenticated_read_app_user_page_access"
  on public.app_user_page_access for select
  to authenticated
  using (true);

drop policy if exists "authenticated_read_fluig_catalog_items" on public.fluig_catalog_items;
create policy "authenticated_read_fluig_catalog_items"
  on public.fluig_catalog_items for select
  to authenticated
  using (true);

grant select on public.app_user_page_access to authenticated;
grant select on public.fluig_catalog_items to authenticated;
revoke insert, update, delete on public.app_user_page_access from authenticated;
revoke insert, update, delete on public.fluig_catalog_items from authenticated;
